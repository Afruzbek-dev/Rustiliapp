-- 0011_login_verifier: browser-bound login. The browser that starts a login holds a random
-- verifier in an HttpOnly cookie; only sha256(verifier) (hex) is stored here, so a nonce that
-- leaks through the Telegram deep link cannot be exchanged by anyone but that browser.
alter table public.login_nonces add column verifier_hash text;

-- The table stays service-role only (no policies, no privileges for API roles).
revoke all on public.login_nonces from anon, authenticated;
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
