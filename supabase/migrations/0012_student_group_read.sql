-- 0012_student_group_read: a student can read THEIR OWN curator group row (name for the UI).
--
-- my_group_ids(): the curator groups of the caller's ACTIVE, unexpired enrollments.
--   SECURITY DEFINER so evaluating the policy does not re-enter enrollments RLS (no recursion).
--   Pending/rejected/expired enrollments give nothing. The policy exposes only the group row
--   itself: other groups of the cohort, the curator's profile and other students stay hidden
--   (profiles/enrollments policies are unchanged).

create function public.my_group_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select e.curator_group_id
  from public.enrollments e
  where e.student_id = auth.uid()
    and e.status = 'active'
    and e.curator_group_id is not null
    and (e.expires_at is null or e.expires_at > now())
$$;

revoke execute on function public.my_group_ids() from public, anon;
grant execute on function public.my_group_ids() to authenticated, service_role;

create policy curator_groups_select_own on public.curator_groups
  for select to authenticated
  using (id in (select public.my_group_ids()));

-- Defence in depth: API roles never need these table privileges.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
