-- 0007_dashboard_helpers: aggregate helpers for the student dashboard.
--
-- my_total_xp(): the caller's lifetime XP, summed in SQL (PostgREST caps row sets, so summing
--   in the client would silently truncate). SECURITY INVOKER: RLS on xp_events still applies,
--   and the explicit auth.uid() filter keeps curators/teachers (who can read other students'
--   rows) from summing anything but their own.
-- bump_daily_task(): increments one of today's task counters in daily_activity.tasks.
--   service_role only; XP/activity is written by the server, never by the client.

create function public.my_total_xp()
returns bigint
language sql stable security invoker set search_path = public as $$
  select coalesce(sum(amount), 0)::bigint from public.xp_events where student_id = auth.uid()
$$;

revoke execute on function public.my_total_xp() from public, anon;
grant execute on function public.my_total_xp() to authenticated, service_role;

create function public.bump_daily_task(p_student uuid, p_key text, p_inc int default 1)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_day date := (now() at time zone 'Asia/Tashkent')::date;
begin
  if p_key is null or p_key not in ('words', 'grammar', 'audio', 'speaking') then
    raise exception 'bump_daily_task: invalid key %', p_key using errcode = '22023';
  end if;
  if p_inc is null or p_inc < 1 then
    raise exception 'bump_daily_task: increment must be >= 1' using errcode = '22023';
  end if;

  insert into public.daily_activity as d (student_id, day, xp, tasks)
  values (p_student, v_day, 0, jsonb_build_object(p_key, p_inc))
  on conflict (student_id, day) do update
    set tasks = jsonb_set(
      d.tasks,
      array[p_key],
      to_jsonb(coalesce((d.tasks ->> p_key)::numeric, 0)::int + p_inc)
    );
end
$$;

revoke execute on function public.bump_daily_task(uuid, text, int) from public, anon, authenticated;
grant execute on function public.bump_daily_task(uuid, text, int) to service_role;

-- Defence in depth: API roles never need these table privileges.
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
