-- 0018_module_tests: everything Task 28 (module tests) needs in the database.
--
--  Schema (spec §6 tests / test_items / test_attempts already exist; this migration only extends them):
--    tests.max_attempts        how many attempts a student may use (default 1: the plan says a second attempt is refused)
--    test_items.lesson_id      optional lesson to re-read when the student is weak in the item's section
--    test_attempts             + deadline (server-held end of the time limit), passed, correct/total counts,
--                              item_results (per exercise: correct/total/units), timed_out
--                              one ACTIVE attempt per (student, test): partial unique index
--    test_attempt_answers      the answers of an attempt. RLS on, NO policy and no grant: only the service
--                              role (server) reads/writes it. Answer keys stay in exercise_keys.
--    one test per module       (the path shows one test node per module)
--
--  Functions (SECURITY DEFINER, search_path pinned). Student side: service_role ONLY, the acting student is
--  passed in and re-checked (a foreign attempt is 'forbidden' 42501, also for unknown ids: no oracle).
--  Grading happens in TypeScript with the existing check() code; the database owns state, the time
--  limit, idempotency, the retake limit and the XP award (inside the finishing transaction).
--    test_start_attempt / test_save_answer / test_finish_attempt
--  Teacher side: test_editor_* (service_role only, p_actor re-checked with can_edit_course_as) and
--    test_results(), executable by authenticated with the authorisation INSIDE (admin or the course's teacher).

-- ---------------------------------------------------------------------------
-- Schema
-- ---------------------------------------------------------------------------
alter table public.tests
  add column max_attempts int not null default 1 check (max_attempts between 1 and 10),
  add constraint tests_pass_score_range check (pass_score is null or (pass_score > 0 and pass_score <= 100)),
  add constraint tests_time_limit_range check (time_limit_min is null or time_limit_min <= 600);

create unique index tests_after_module_id_key on public.tests (after_module_id) where after_module_id is not null;

alter table public.test_items
  add column lesson_id uuid references public.lessons (id) on delete set null;
create index test_items_lesson_id_idx on public.test_items (lesson_id) where lesson_id is not null;

alter table public.test_attempts
  add column deadline      timestamptz,
  add column passed        boolean,
  add column correct_count int check (correct_count >= 0),
  add column total_count   int check (total_count >= 0),
  add column item_results  jsonb not null default '{}',
  add column timed_out     boolean not null default false,
  add constraint test_attempts_score_range check (score is null or (score >= 0 and score <= 100));

create unique index test_attempts_one_active_idx on public.test_attempts (student_id, test_id) where finished_at is null;

create table public.test_attempt_answers (
  attempt_id  uuid not null references public.test_attempts (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  answer      jsonb not null,
  saved_at    timestamptz not null default now(),
  primary key (attempt_id, exercise_id)
);
alter table public.test_attempt_answers enable row level security;
revoke all on public.test_attempt_answers from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Student side
-- ---------------------------------------------------------------------------
-- A save is still accepted this long after the deadline (network latency of the auto-submit).
create function public.test_save_grace() returns interval
language sql immutable set search_path = public as $$ select interval '15 seconds' $$;

-- Is the student actively enrolled (not expired) in the course of the test?
create function public.student_in_course(p_student uuid, p_course uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.enrollments e join public.cohorts c on c.id = e.cohort_id
    where e.student_id = p_student and c.course_id = p_course
      and e.status = 'active' and (e.expires_at is null or e.expires_at > now())
  )
$$;

-- outcome: 'started' | 'resumed' (an active attempt exists) | 'expired' (the active attempt ran out of
-- time and must be finished first) | 'limit' (no attempts left) | 'passed' (already passed) | 'no_items'.
-- A test that is unknown, unpublished or of a course the student is not enrolled in is 'forbidden' (42501).
create function public.test_start_attempt(p_student uuid, p_test uuid)
returns table (outcome text, attempt_id uuid, started_at timestamptz, deadline timestamptz)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_test public.tests%rowtype;
  v_att public.test_attempts%rowtype;
  v_n int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_student::text || ':' || p_test::text, 18));
  select * into v_test from public.tests t where t.id = p_test;
  if not found or not v_test.published or not public.student_in_course(p_student, v_test.course_id)
     or not exists (select 1 from public.profiles p where p.id = p_student and p.role = 'student') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_att from public.test_attempts a
   where a.student_id = p_student and a.test_id = p_test and a.finished_at is null;
  if found then
    return query select case when v_att.deadline is not null and now() > v_att.deadline then 'expired' else 'resumed' end,
                        v_att.id, v_att.started_at, v_att.deadline;
    return;
  end if;

  if exists (select 1 from public.test_attempts a where a.student_id = p_student and a.test_id = p_test and a.passed) then
    return query select 'passed'::text, null::uuid, null::timestamptz, null::timestamptz;
    return;
  end if;
  select count(*) into v_n from public.test_attempts a where a.student_id = p_student and a.test_id = p_test;
  if v_n >= v_test.max_attempts then
    return query select 'limit'::text, null::uuid, null::timestamptz, null::timestamptz;
    return;
  end if;
  if not exists (select 1 from public.test_items i where i.test_id = p_test) then
    return query select 'no_items'::text, null::uuid, null::timestamptz, null::timestamptz;
    return;
  end if;

  insert into public.test_attempts (student_id, test_id, started_at, deadline)
  values (
    p_student, p_test, clock_timestamp(),
    case when v_test.time_limit_min is null then null else clock_timestamp() + make_interval(mins => v_test.time_limit_min) end
  )
  returning * into v_att;
  return query select 'started'::text, v_att.id, v_att.started_at, v_att.deadline;
end
$$;

-- 'ok' | 'finished' (attempt already finished: nothing is stored) | 'expired' (past deadline + grace).
-- Raises 42501 for a foreign / unknown attempt and 22023 when the exercise is not an item of the test.
create function public.test_save_answer(p_student uuid, p_attempt uuid, p_exercise uuid, p_answer jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_att public.test_attempts%rowtype;
begin
  select * into v_att from public.test_attempts a where a.id = p_attempt and a.student_id = p_student for update;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_att.finished_at is not null then
    return 'finished';
  end if;
  if v_att.deadline is not null and now() > v_att.deadline + public.test_save_grace() then
    return 'expired';
  end if;
  if p_answer is null or jsonb_typeof(p_answer) <> 'object' or length(p_answer::text) > 20000 then
    raise exception 'invalid answer' using errcode = '22023';
  end if;
  if not exists (select 1 from public.test_items i where i.test_id = v_att.test_id and i.exercise_id = p_exercise) then
    raise exception 'not a test item' using errcode = '22023';
  end if;
  insert into public.test_attempt_answers (attempt_id, exercise_id, answer)
  values (p_attempt, p_exercise, p_answer)
  on conflict (attempt_id, exercise_id) do update set answer = excluded.answer, saved_at = now();
  return 'ok';
end
$$;

-- Finishes an attempt with the result the server graded. IDEMPOTENT: a finished attempt is returned
-- unchanged (outcome 'already'), so a double submit / auto-submit race stores and pays once.
-- The test XP (spec §10: score % x 2, = round(score * 2)) is awarded in this transaction on a pass, once
-- per (student, test) thanks to the unique ref (the test id).
create function public.test_finish_attempt(
  p_student uuid, p_attempt uuid, p_score numeric, p_correct int, p_total int,
  p_section_scores jsonb, p_item_results jsonb
) returns table (outcome text, score numeric, passed boolean, timed_out boolean, xp_awarded int)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_att public.test_attempts%rowtype;
  v_pass numeric;
  v_passed boolean;
  v_timed_out boolean;
  v_xp int := 0;
begin
  select * into v_att from public.test_attempts a where a.id = p_attempt and a.student_id = p_student for update;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_att.finished_at is not null then
    return query select 'already'::text, v_att.score, v_att.passed, v_att.timed_out, 0;
    return;
  end if;
  if p_score is null or p_score < 0 or p_score > 100 or p_correct is null or p_total is null
     or p_correct < 0 or p_total < 1 or p_correct > p_total
     or jsonb_typeof(p_section_scores) <> 'object' or jsonb_typeof(p_item_results) <> 'object' then
    raise exception 'invalid result' using errcode = '22023';
  end if;
  select t.pass_score into v_pass from public.tests t where t.id = v_att.test_id;
  v_passed := p_score >= coalesce(v_pass, 0);
  v_timed_out := v_att.deadline is not null and now() > v_att.deadline;
  update public.test_attempts a
     set finished_at = now(), score = round(p_score, 2), passed = v_passed, correct_count = p_correct, total_count = p_total,
         section_scores = p_section_scores, item_results = p_item_results, timed_out = v_timed_out
   where a.id = p_attempt;
  if v_passed and round(p_score * 2) > 0 then
    if public.award_xp(p_student, round(p_score * 2)::int, 'test_completed', v_att.test_id::text) then
      v_xp := round(p_score * 2)::int;
    end if;
  end if;
  return query select 'finished'::text, round(p_score, 2), v_passed, v_timed_out, v_xp;
end
$$;

-- ---------------------------------------------------------------------------
-- Teacher: results (authorisation inside)
-- ---------------------------------------------------------------------------
create function public.test_results(p_test uuid)
returns table (student_id uuid, full_name text, attempts int, best_score numeric, passed boolean,
               last_finished_at timestamptz, in_progress boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_course uuid := public.test_course_id(p_test);
begin
  if v_course is null or not public.teaches_course(v_course) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    with roster as (
      select e.student_id from public.enrollments e join public.cohorts c on c.id = e.cohort_id
       where c.course_id = v_course and e.status = 'active'
      union
      select a.student_id from public.test_attempts a where a.test_id = p_test
    )
    select r.student_id, p.full_name,
           (select count(*)::int from public.test_attempts a where a.student_id = r.student_id and a.test_id = p_test and a.finished_at is not null),
           (select max(a.score) from public.test_attempts a where a.student_id = r.student_id and a.test_id = p_test and a.finished_at is not null),
           coalesce((select bool_or(a.passed) from public.test_attempts a where a.student_id = r.student_id and a.test_id = p_test and a.finished_at is not null), false),
           (select max(a.finished_at) from public.test_attempts a where a.student_id = r.student_id and a.test_id = p_test),
           exists (select 1 from public.test_attempts a where a.student_id = r.student_id and a.test_id = p_test and a.finished_at is null)
      from roster r join public.profiles p on p.id = r.student_id
     order by p.full_name, r.student_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Teacher: editor functions (service role, p_actor re-checked)
-- ---------------------------------------------------------------------------
create function public.test_editor_course(p_test uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select t.course_id from public.tests t where t.id = p_test
$$;

create function public.test_editor_require(p_actor uuid, p_test uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_course uuid := public.test_course_id(p_test);
begin
  if v_course is null or not public.can_edit_course_as(p_actor, v_course) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return v_course;
end
$$;

-- Structure of a test (its items) is frozen once any student has an attempt: stored results are snapshots.
create function public.test_require_no_attempts(p_test uuid) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if exists (select 1 from public.test_attempts a where a.test_id = p_test) then
    raise exception 'test has attempts' using errcode = '23514';
  end if;
end
$$;

create function public.test_editor_create(p_actor uuid, p_course uuid, p_module uuid, p_title text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform public.editor_require(p_actor, p_course);
  if p_title is null or length(btrim(p_title)) not between 1 and 200 then
    raise exception 'invalid title' using errcode = '22023';
  end if;
  if p_module is null or public.module_course_id(p_module) is distinct from p_course then
    raise exception 'invalid module' using errcode = '22023';
  end if;
  insert into public.tests (course_id, after_module_id, title, published)
  values (p_course, p_module, btrim(p_title), false)
  returning id into v_id;
  return v_id;
end
$$;

create function public.test_editor_update(
  p_actor uuid, p_test uuid, p_title text, p_pass_score numeric, p_time_limit int, p_max_attempts int
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pub boolean;
begin
  perform public.test_editor_require(p_actor, p_test);
  if p_title is null or length(btrim(p_title)) not between 1 and 200
     or (p_pass_score is not null and (p_pass_score <= 0 or p_pass_score > 100))
     or (p_time_limit is not null and (p_time_limit < 1 or p_time_limit > 600))
     or p_max_attempts is null or p_max_attempts not between 1 and 10 then
    raise exception 'invalid test settings' using errcode = '22023';
  end if;
  select t.published into v_pub from public.tests t where t.id = p_test for update;
  if v_pub and p_pass_score is null then
    raise exception 'published test needs a pass score' using errcode = '23514';
  end if;
  update public.tests
     set title = btrim(p_title), pass_score = p_pass_score, time_limit_min = p_time_limit, max_attempts = p_max_attempts
   where id = p_test;
end
$$;

-- Writes a test-owned exercise (no block) + its key. p_exercise: {type, prompt, payload, key}.
create function public.test_write_exercise(p_ex uuid, p_course uuid, p_exercise jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_ex;
  v_type public.exercise_type;
  v_key jsonb := p_exercise -> 'key';
begin
  if p_exercise is null or jsonb_typeof(p_exercise) <> 'object' or length(p_exercise::text) > 200000 then
    raise exception 'invalid exercise' using errcode = '22023';
  end if;
  v_type := (p_exercise ->> 'type')::public.exercise_type;
  if v_type not in ('classify', 'fill_blank', 'conjugate', 'choose', 'match') then
    raise exception 'test items must be auto-gradable' using errcode = '22023';
  end if;
  if v_key is null or jsonb_typeof(v_key) <> 'object' or v_key = '{}'::jsonb then
    raise exception 'answer key required' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.exercises (course_id, block_id, type, prompt, payload, check_mode, xp)
    values (p_course, null, v_type, nullif(p_exercise ->> 'prompt', ''), coalesce(p_exercise -> 'payload', '{}'::jsonb), 'auto', 0)
    returning id into v_id;
  else
    update public.exercises
       set type = v_type, prompt = nullif(p_exercise ->> 'prompt', ''), payload = coalesce(p_exercise -> 'payload', '{}'::jsonb)
     where id = v_id and block_id is null and course_id = p_course;
    if not found then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;
  insert into public.exercise_keys (exercise_id, answer) values (v_id, v_key)
  on conflict (exercise_id) do update set answer = excluded.answer;
  return v_id;
end
$$;

create function public.test_editor_add_item(p_actor uuid, p_test uuid, p_section public.test_section, p_lesson uuid, p_exercise jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_course uuid := public.test_editor_require(p_actor, p_test);
  v_ex uuid;
begin
  perform 1 from public.tests where id = p_test for update;
  perform public.test_require_no_attempts(p_test);
  if p_lesson is not null and public.lesson_course_id(p_lesson) is distinct from v_course then
    raise exception 'invalid lesson' using errcode = '22023';
  end if;
  if (select count(*) from public.test_items where test_id = p_test) >= 200 then
    raise exception 'too many items' using errcode = '22023';
  end if;
  v_ex := public.test_write_exercise(null, v_course, p_exercise);
  insert into public.test_items (test_id, exercise_id, section, position, lesson_id)
  values (p_test, v_ex, p_section,
          coalesce((select max(position) from public.test_items where test_id = p_test), 0) + 1, p_lesson);
  return v_ex;
end
$$;

create function public.test_editor_update_item(
  p_actor uuid, p_test uuid, p_exercise_id uuid, p_section public.test_section, p_lesson uuid, p_exercise jsonb
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_course uuid := public.test_editor_require(p_actor, p_test);
begin
  perform 1 from public.tests where id = p_test for update;
  perform public.test_require_no_attempts(p_test);
  if not exists (select 1 from public.test_items where test_id = p_test and exercise_id = p_exercise_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_lesson is not null and public.lesson_course_id(p_lesson) is distinct from v_course then
    raise exception 'invalid lesson' using errcode = '22023';
  end if;
  perform public.test_write_exercise(p_exercise_id, v_course, p_exercise);
  update public.test_items set section = p_section, lesson_id = p_lesson
   where test_id = p_test and exercise_id = p_exercise_id;
end
$$;

create function public.test_editor_remove_item(p_actor uuid, p_test uuid, p_exercise_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.test_editor_require(p_actor, p_test);
  perform 1 from public.tests where id = p_test for update;
  perform public.test_require_no_attempts(p_test);
  delete from public.test_items where test_id = p_test and exercise_id = p_exercise_id;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- a test-owned exercise goes with its item; a lesson exercise (block) is never touched
  delete from public.exercises e
   where e.id = p_exercise_id and e.block_id is null
     and not exists (select 1 from public.test_items ti where ti.exercise_id = e.id);
  update public.test_items ti
     set position = r.rn
    from (select exercise_id, row_number() over (order by position) as rn from public.test_items where test_id = p_test) r
   where ti.test_id = p_test and ti.exercise_id = r.exercise_id;
end
$$;

create function public.test_editor_reorder_items(p_actor uuid, p_test uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.test_editor_require(p_actor, p_test);
  perform 1 from public.tests where id = p_test for update;
  if p_ids is null
     or coalesce(array_length(p_ids, 1), 0) <> (select count(*) from public.test_items where test_id = p_test)
     or (select count(distinct x) from unnest(p_ids) as x) <> coalesce(array_length(p_ids, 1), 0)
     or exists (select 1 from unnest(p_ids) as x where not exists (select 1 from public.test_items i where i.test_id = p_test and i.exercise_id = x)) then
    raise exception 'invalid order' using errcode = '22023';
  end if;
  update public.test_items i set position = o.ord from unnest(p_ids) with ordinality as o(id, ord)
   where i.test_id = p_test and i.exercise_id = o.id;
end
$$;

-- Publishing needs: a module, a reachable pass score, at least one item, and every item a test-owned
-- auto-gradable exercise with an answer key. Atomic with the check (the test row is locked).
create function public.test_editor_set_published(p_actor uuid, p_test uuid, p_published boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_test public.tests%rowtype;
begin
  perform public.test_editor_require(p_actor, p_test);
  select * into v_test from public.tests where id = p_test for update;
  if p_published then
    if v_test.after_module_id is null or v_test.pass_score is null or v_test.pass_score <= 0 or v_test.pass_score > 100 then
      raise exception 'test needs a module and a pass score' using errcode = '23514';
    end if;
    if not exists (select 1 from public.test_items where test_id = p_test) then
      raise exception 'test has no items' using errcode = '23514';
    end if;
    if exists (
         select 1 from public.test_items i join public.exercises e on e.id = i.exercise_id
          where i.test_id = p_test
            and (e.block_id is not null
                 or e.type not in ('classify', 'fill_blank', 'conjugate', 'choose', 'match')
                 or e.check_mode <> 'auto'
                 or not exists (select 1 from public.exercise_keys k where k.exercise_id = e.id and k.answer <> '{}'::jsonb))
       ) then
      raise exception 'test items must be test-owned auto-gradable exercises with keys' using errcode = '23514';
    end if;
  end if;
  update public.tests set published = p_published where id = p_test;
end
$$;

create function public.test_editor_delete(p_actor uuid, p_test uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.test_editor_require(p_actor, p_test);
  perform 1 from public.tests where id = p_test for update;
  perform public.test_require_no_attempts(p_test);
  delete from public.exercises e
   where e.block_id is null
     and e.id in (select exercise_id from public.test_items where test_id = p_test)
     and not exists (select 1 from public.test_items ti where ti.exercise_id = e.id and ti.test_id <> p_test);
  delete from public.tests where id = p_test;
end
$$;

-- ---------------------------------------------------------------------------
-- Grants: everything service-role only, except test_results (authorisation inside)
-- ---------------------------------------------------------------------------
revoke execute on function
  public.test_save_grace(), public.student_in_course(uuid, uuid),
  public.test_start_attempt(uuid, uuid), public.test_save_answer(uuid, uuid, uuid, jsonb),
  public.test_finish_attempt(uuid, uuid, numeric, int, int, jsonb, jsonb),
  public.test_results(uuid),
  public.test_editor_course(uuid), public.test_editor_require(uuid, uuid), public.test_require_no_attempts(uuid),
  public.test_editor_create(uuid, uuid, uuid, text), public.test_editor_update(uuid, uuid, text, numeric, int, int),
  public.test_write_exercise(uuid, uuid, jsonb),
  public.test_editor_add_item(uuid, uuid, public.test_section, uuid, jsonb),
  public.test_editor_update_item(uuid, uuid, uuid, public.test_section, uuid, jsonb),
  public.test_editor_remove_item(uuid, uuid, uuid), public.test_editor_reorder_items(uuid, uuid, uuid[]),
  public.test_editor_set_published(uuid, uuid, boolean), public.test_editor_delete(uuid, uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.test_save_grace(), public.student_in_course(uuid, uuid),
  public.test_start_attempt(uuid, uuid), public.test_save_answer(uuid, uuid, uuid, jsonb),
  public.test_finish_attempt(uuid, uuid, numeric, int, int, jsonb, jsonb),
  public.test_editor_course(uuid), public.test_editor_require(uuid, uuid), public.test_require_no_attempts(uuid),
  public.test_editor_create(uuid, uuid, uuid, text), public.test_editor_update(uuid, uuid, text, numeric, int, int),
  public.test_write_exercise(uuid, uuid, jsonb),
  public.test_editor_add_item(uuid, uuid, public.test_section, uuid, jsonb),
  public.test_editor_update_item(uuid, uuid, uuid, public.test_section, uuid, jsonb),
  public.test_editor_remove_item(uuid, uuid, uuid), public.test_editor_reorder_items(uuid, uuid, uuid[]),
  public.test_editor_set_published(uuid, uuid, boolean), public.test_editor_delete(uuid, uuid)
  to service_role;

grant execute on function public.test_results(uuid) to authenticated, service_role;

-- Defence in depth: API roles never need these table privileges.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
