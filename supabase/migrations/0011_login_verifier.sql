-- 0011_login_verifier: browser-bound login. The browser that starts a login holds a random
-- verifier in an HttpOnly cookie; only sha256(verifier) (hex) is stored here, so a nonce that
-- leaks through the Telegram deep link cannot be exchanged by anyone but that browser.
alter table public.login_nonces
  add column verifier_hash text check (verifier_hash ~ '^[0-9a-f]{64}$');

-- expires_at serves the cleanup; telegram_id serves the bot's "latest nonce for this user" lookup.
create index login_nonces_expires_at_idx on public.login_nonces (expires_at);
create index login_nonces_telegram_id_idx on public.login_nonces (telegram_id);

-- The table stays service-role only (no policies, no privileges for API roles).
revoke all on public.login_nonces from anon, authenticated;

-- Atomic single-use consume: confirmed -> consumed for this verifier while unexpired (DB clock).
-- Returns the confirmed telegram_id, or null when nothing was consumed.
create function public.consume_login_nonce(p_nonce text, p_hash text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_tg bigint;
begin
  update public.login_nonces
     set status = 'consumed'
   where nonce = p_nonce
     and status = 'confirmed'
     and expires_at > now()
     and verifier_hash = p_hash
  returning telegram_id into v_tg;
  return v_tg;
end
$$;

-- Bounded cleanup of long-dead rows (called occasionally by /start); never scans unbounded work.
create function public.purge_login_nonces(p_limit int default 500) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  delete from public.login_nonces
   where ctid in (
     select ctid from public.login_nonces
      where expires_at < now() - interval '1 hour'
      limit p_limit
   );
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.consume_login_nonce(text, text) from public, anon, authenticated;
revoke all on function public.purge_login_nonces(int) from public, anon, authenticated;
grant execute on function public.consume_login_nonce(text, text) to service_role;
grant execute on function public.purge_login_nonces(int) to service_role;

revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
