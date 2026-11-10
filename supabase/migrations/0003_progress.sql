-- 0003_progress: part progress, attempts, submissions, reviews, SRS cards, test attempts.
-- Spec §6, §7, §9, §11, §12.
--
-- All writes to these tables go through server routes with the service role (XP, checking
-- and grading must never be client-controlled), so API roles get SELECT only.
-- Read access:
--   student : own rows (and reviews of own submissions)
--   curator : submissions/reviews of their groups' students
--   teacher : rows belonging to their own courses; admin: everything

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.part_status as enum ('in_progress', 'completed');
create type public.submission_kind as enum ('audio', 'video', 'text');
create type public.submission_status as enum ('pending', 'reviewed');
create type public.review_channel as enum ('web', 'telegram');

-- ---------------------------------------------------------------------------
-- Score validation (rubric: completeness, pronunciation, grammar, fluency; each 1..5)
-- ---------------------------------------------------------------------------
create function public.valid_review_scores(s jsonb) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(
    jsonb_typeof(s) = 'object'
    and (select array_agg(k order by k) from jsonb_object_keys(s) as k)
        = array['completeness', 'fluency', 'grammar', 'pronunciation']
    and (select bool_and(jsonb_typeof(v) = 'number' and v::text in ('1', '2', '3', '4', '5'))
         from jsonb_each(s) as e(k, v)),
    false)
$$;

-- Partial scores collected step by step in Telegram: a subset of the rubric keys.
create function public.valid_draft_scores(s jsonb) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(
    jsonb_typeof(s) = 'object'
    and (select coalesce(bool_and(k in ('completeness', 'pronunciation', 'grammar', 'fluency')
                                  and jsonb_typeof(v) = 'number' and v::text in ('1', '2', '3', '4', '5')), true)
         from jsonb_each(s) as e(k, v)),
    false)
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.part_progress (
  student_id     uuid not null references public.profiles (id) on delete cascade,
  lesson_part_id uuid not null references public.lesson_parts (id) on delete cascade,
  status         public.part_status not null default 'in_progress',
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  primary key (student_id, lesson_part_id),
  check ((status = 'completed') = (completed_at is not null))
);

create table public.attempts (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.profiles (id) on delete cascade,
  exercise_id uuid not null references public.exercises (id) on delete cascade,
  answer      jsonb not null,
  is_correct  boolean not null,
  created_at  timestamptz not null default now()
);
create index attempts_student_exercise_idx on public.attempts (student_id, exercise_id);
create index attempts_exercise_id_idx on public.attempts (exercise_id);

create table public.submissions (
  id                    uuid primary key default gen_random_uuid(),
  student_id            uuid not null references public.profiles (id) on delete cascade,
  exercise_id           uuid not null references public.exercises (id) on delete cascade,
  curator_group_id      uuid references public.curator_groups (id) on delete set null,
  kind                  public.submission_kind not null,
  storage_path          text,
  tg_file_id            text,
  tg_archive_message_id bigint,
  text_answer           text,
  status                public.submission_status not null default 'pending',
  draft_scores          jsonb not null default '{}' check (public.valid_draft_scores(draft_scores)),
  created_at            timestamptz not null default now()
);
create index submissions_student_id_idx on public.submissions (student_id);
create index submissions_group_status_idx on public.submissions (curator_group_id, status);
create index submissions_exercise_id_idx on public.submissions (exercise_id);

create table public.reviews (
  id            uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  reviewer_id   uuid references public.profiles (id) on delete set null,
  channel       public.review_channel not null,
  scores        jsonb not null check (public.valid_review_scores(scores)),
  total         numeric(3, 2) not null,
  comment       text,
  is_override   boolean not null default false,
  created_at    timestamptz not null default now(),
  -- total = mean of the four criteria, rounded to 2 decimals
  check (total = round(((scores ->> 'completeness')::numeric + (scores ->> 'pronunciation')::numeric
                      + (scores ->> 'grammar')::numeric + (scores ->> 'fluency')::numeric) / 4, 2))
);
-- history is kept; the latest review per submission is the effective one
create index reviews_submission_created_idx on public.reviews (submission_id, created_at desc);

create table public.srs_cards (
  student_id    uuid not null references public.profiles (id) on delete cascade,
  word_id       uuid not null references public.words (id) on delete cascade,
  interval_days numeric(8, 4) not null default 0 check (interval_days >= 0),
  ease          numeric(4, 2) not null default 2.5 check (ease > 0),
  due_at        timestamptz not null default now(),
  reps          int not null default 0 check (reps >= 0),
  lapses        int not null default 0 check (lapses >= 0),
  is_difficult  boolean not null default false,
  primary key (student_id, word_id)
);
create index srs_cards_due_idx on public.srs_cards (student_id, due_at);

create table public.test_attempts (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.profiles (id) on delete cascade,
  test_id        uuid not null references public.tests (id) on delete cascade,
  score          numeric(5, 2),
  section_scores jsonb not null default '{}',
  started_at     timestamptz not null default now(),
  finished_at    timestamptz
);
create index test_attempts_student_test_idx on public.test_attempts (student_id, test_id);

-- ---------------------------------------------------------------------------
-- Access helper
-- ---------------------------------------------------------------------------
-- Who may read a submission (and its reviews): its student; the curator of the group it
-- was filed under, or of the student's current group in the same course; the course's
-- teacher; admins.
create function public.can_read_submission(p_submission uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.submissions s
    where s.id = p_submission
      and (
        s.student_id = auth.uid()
        or s.curator_group_id in (select public.curated_group_ids())
        or (
          s.student_id in (select public.curated_student_ids())
          and public.exercise_course_id(s.exercise_id) in (select public.curated_course_ids())
        )
        or public.teaches_course(public.exercise_course_id(s.exercise_id))
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- RLS: read-only for API roles; writes are service-role only.
-- ---------------------------------------------------------------------------
alter table public.part_progress enable row level security;
alter table public.attempts      enable row level security;
alter table public.submissions   enable row level security;
alter table public.reviews       enable row level security;
alter table public.srs_cards     enable row level security;
alter table public.test_attempts enable row level security;

revoke all on public.part_progress, public.attempts, public.submissions, public.reviews,
  public.srs_cards, public.test_attempts from anon;
revoke insert, update, delete, truncate on public.part_progress, public.attempts, public.submissions,
  public.reviews, public.srs_cards, public.test_attempts from authenticated;

create policy part_progress_select on public.part_progress for select to authenticated
  using (student_id = auth.uid() or public.teaches_course(public.part_course_id(lesson_part_id)));

create policy attempts_select on public.attempts for select to authenticated
  using (student_id = auth.uid() or public.teaches_course(public.exercise_course_id(exercise_id)));

create policy submissions_select on public.submissions for select to authenticated
  using (
    student_id = auth.uid()
    or curator_group_id in (select public.curated_group_ids())
    or (
      student_id in (select public.curated_student_ids())
      and public.exercise_course_id(exercise_id) in (select public.curated_course_ids())
    )
    or public.teaches_course(public.exercise_course_id(exercise_id))
  );

create policy reviews_select on public.reviews for select to authenticated
  using (public.can_read_submission(submission_id));

create policy srs_cards_select on public.srs_cards for select to authenticated
  using (student_id = auth.uid() or public.teaches_course(public.word_course_id(word_id)));

create policy test_attempts_select on public.test_attempts for select to authenticated
  using (student_id = auth.uid() or public.teaches_course(public.test_course_id(test_id)));
