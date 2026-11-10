-- 0006_attempt_stats: server-side aggregates over `attempts` for the attempt-checking API.
--
-- Computed in SQL (not by fetching rows through PostgREST) so results are never silently
-- truncated by the API's max-rows limit. Callable by service_role ONLY: they take a student id
-- as a parameter and bypass RLS.

-- Totals for one ref: p_item null = whole exercise, otherwise attempts whose answer.itemId = p_item.
create function public.attempt_stats(p_student uuid, p_exercise uuid, p_item text)
returns table (total bigint, correct bigint)
language sql stable security definer set search_path = public as $$
  select count(*)::bigint, (count(*) filter (where a.is_correct))::bigint
  from public.attempts a
  where a.student_id = p_student
    and a.exercise_id = p_exercise
    and (p_item is null or a.answer ->> 'itemId' = p_item)
$$;

-- Distinct correct refs (exercise, item) of the student for exercises in the part's published blocks.
create function public.correct_refs(p_student uuid, p_part uuid)
returns table (exercise_id uuid, item_id text)
language sql stable security definer set search_path = public as $$
  select distinct a.exercise_id, a.answer ->> 'itemId'
  from public.attempts a
  join public.exercises e on e.id = a.exercise_id
  join public.blocks b on b.id = e.block_id
  where a.student_id = p_student
    and a.is_correct
    and b.lesson_part_id = p_part
    and b.published
    -- test items are graded by the test flow and never count towards part completion
    and not exists (select 1 from public.test_items ti where ti.exercise_id = a.exercise_id)
$$;

revoke execute on function public.attempt_stats(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.correct_refs(uuid, uuid) from public, anon, authenticated;
grant execute on function public.attempt_stats(uuid, uuid, text) to service_role;
grant execute on function public.correct_refs(uuid, uuid) to service_role;

-- API roles never get these on any table in public.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
