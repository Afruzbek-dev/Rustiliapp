-- 0010_path_helpers: helpers for the student learning path.
--
-- published_part_ids(): which of the given lesson parts have at least one published block.
--   Returned as DISTINCT part ids in SQL, because selecting one row per block through PostgREST
--   would be silently capped at 1000 rows and drop parts from the path. SECURITY INVOKER: RLS on
--   blocks still decides what the caller can see (a student gets nothing for foreign courses).

create function public.published_part_ids(p_part_ids uuid[])
returns setof uuid
language sql stable security invoker set search_path = public as $$
  select distinct b.lesson_part_id
  from public.blocks b
  where b.lesson_part_id = any (p_part_ids) and b.published
$$;

revoke execute on function public.published_part_ids(uuid[]) from public, anon;
grant execute on function public.published_part_ids(uuid[]) to authenticated, service_role;

-- Defence in depth: API roles never need these table privileges.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
