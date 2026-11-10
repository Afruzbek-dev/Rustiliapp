-- 0008_srs: spaced-repetition support.
--
-- srs_cards.first_studied_at: NULL = the card was never studied ("new"); set once, on the first
--   grade of any kind (again/hard/good). The per-day cap of 10 NEW cards counts cards whose
--   first_studied_at falls on today's Asia/Tashkent day. (A card answered "again" keeps reps = 0
--   but is no longer new: it comes back through the due queue after 10 minutes.)
-- srs_add_lesson_words(): gives a student a card for every word of the lesson a part belongs to,
--   skipping words they already have (idempotent). Called when a part is completed.
-- srs_apply_grade(): atomically stores a graded card and reports whether this was the card's very
--   first study (so the caller bumps the daily 'words' task exactly once per card).
-- All writes happen server-side with the service role; students can only read their own cards.

alter table public.srs_cards add column first_studied_at timestamptz;

-- Cards graded before this column existed count as studied.
update public.srs_cards set first_studied_at = coalesce(due_at, now()) where reps > 0 or lapses > 0;

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

-- Returns true when this call was the card's first study, false when it was studied before,
-- NULL when the student has no such card.
create function public.srs_apply_grade(
  p_student uuid,
  p_word uuid,
  p_interval numeric,
  p_ease numeric,
  p_due timestamptz,
  p_reps int,
  p_lapses int
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_first timestamptz;
begin
  select c.first_studied_at into v_first
  from public.srs_cards c
  where c.student_id = p_student and c.word_id = p_word
  for update;
  if not found then
    return null;
  end if;

  update public.srs_cards
     set interval_days = p_interval,
         ease = p_ease,
         due_at = p_due,
         reps = p_reps,
         lapses = p_lapses,
         first_studied_at = coalesce(first_studied_at, now())
   where student_id = p_student and word_id = p_word;

  return v_first is null;
end
$$;

revoke execute on function public.srs_add_lesson_words(uuid, uuid) from public, anon, authenticated;
grant execute on function public.srs_add_lesson_words(uuid, uuid) to service_role;
revoke execute on function public.srs_apply_grade(uuid, uuid, numeric, numeric, timestamptz, int, int)
  from public, anon, authenticated;
grant execute on function public.srs_apply_grade(uuid, uuid, numeric, numeric, timestamptz, int, int)
  to service_role;

-- Defence in depth: API roles never need these table privileges.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
