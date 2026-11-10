-- 0005_auth_lookup: find an auth user id by email without paging auth.admin.listUsers.
-- Used by the Telegram bot to recover an existing `tg_<id>@users.internal` user.
-- Service role only: it reads auth.users, so it must never be callable by API users.

create function public.auth_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = lower(p_email) limit 1
$$;

revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

-- Tables created after this point must not hand API roles TRUNCATE / TRIGGER / REFERENCES
-- through default privileges (earlier tables are covered by explicit revokes in their migrations).
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
