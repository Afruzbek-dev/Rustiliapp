-- 0008_srs: spaced-repetition support.
--
-- srs_cards.first_studied_at: NULL = the card was never studied ("new"); set once, on the first
--   grade of any kind (again/hard/good). The per-day cap of 10 NEW cards counts cards whose
--   first_studied_at falls on today's Asia/Tashkent day. (A card answered "again" keeps reps = 0
--   but is no longer new: it comes back through the due queue after 10 minutes.)
-- srs_add_lesson_words(): gives a student a card for every word of the lesson a part belongs to,
--   skipping words they already have (idempotent). Called when a part is completed.
-- srs_apply_grade(): compare-and-swap store of a graded card; reports whether it was the card's very
--   first study (so the caller bumps the daily 'words' task exactly once per card), a replay of the
--   same request, or a conflict with a newer state.
-- All writes happen server-side with the service role; students can only read their own cards.

alter table public.srs_cards add column first_studied_at timestamptz;
-- Id of the last applied grade request: an exact retry of the same request is a no-op.
alter table public.srs_cards add column last_request_id uuid;

-- Cards graded before this column existed count as studied.
update public.srs_cards set first_studied_at = coalesce(due_at, now()) where reps > 0 or lapses > 0 or interval_days > 0;

create index srs_cards_new_idx on public.srs_cards (student_id) where first_studied_at is null;
create index srs_cards_studied_idx on public.srs_cards (student_id, first_studied_at)
  where first_studied_at is not null;

create function public.srs_add_lesson_words(p_student uuid, p_part uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  insert into public.srs_cards (student_id, word_id)
  select p_student, lw.word_id
  from public.lesson_parts lp
  join public.lesson_words lw on lw.lesson_id = lp.lesson_id
  where lp.id = p_part
  on conflict (student_id, word_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Compare-and-swap grade. The caller computed the new state from (p_expect_reps, p_expect_lapses,
-- p_expect_due); the row is only updated while it still has that state (checked under FOR UPDATE).
-- Result: 'first'    applied, and it was the card's first study;
--         'applied'  applied;
--         'replay'   p_request equals the last applied request id: nothing changed;
--         'conflict' the card moved on since the caller read it: nothing changed;
--         'missing'  the student has no such card.
-- due_at is compared at millisecond precision (JS Date round-trips lose microseconds).
create function public.srs_apply_grade(
  p_student uuid,
  p_word uuid,
  p_interval numeric,
  p_ease numeric,
  p_due timestamptz,
  p_reps int,
  p_lapses int,
  p_expect_reps int,
  p_expect_lapses int,
  p_expect_due timestamptz,
  p_request uuid default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  c public.srs_cards%rowtype;
begin
  select * into c
  from public.srs_cards
  where student_id = p_student and word_id = p_word
  for update;
  if not found then
    return 'missing';
  end if;

  if p_request is not null and c.last_request_id = p_request then
    return 'replay';
  end if;
  if c.reps <> p_expect_reps
     or c.lapses <> p_expect_lapses
     or date_trunc('milliseconds', c.due_at) <> date_trunc('milliseconds', p_expect_due) then
    return 'conflict';
  end if;

  update public.srs_cards
     set interval_days = p_interval,
         ease = p_ease,
         due_at = p_due,
         reps = p_reps,
         lapses = p_lapses,
         first_studied_at = coalesce(first_studied_at, now()),
         last_request_id = p_request
   where student_id = p_student and word_id = p_word;

  return case when c.first_studied_at is null then 'first' else 'applied' end;
end
$$;

revoke execute on function public.srs_add_lesson_words(uuid, uuid) from public, anon, authenticated;
grant execute on function public.srs_add_lesson_words(uuid, uuid) to service_role;
revoke execute on function public.srs_apply_grade(uuid, uuid, numeric, numeric, timestamptz, int, int, int, int, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.srs_apply_grade(uuid, uuid, numeric, numeric, timestamptz, int, int, int, int, timestamptz, uuid)
  to service_role;

-- Defence in depth: API roles never need these table privileges.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
