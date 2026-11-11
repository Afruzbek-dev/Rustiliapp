# Po russki

A Russian-language learning platform for Uzbek-speaking students: structured lessons and exercises,
XP/gamification, curator grading of written/voice work, and a Telegram bot for login and notifications.

**Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4, Supabase (Postgres + RLS + Auth),
grammY (Telegram), Vitest, Playwright.

## Local setup

Requirements: Node 22, pnpm 10, PostgreSQL 16 server binaries (for DB tests only).

```bash
pnpm install
cp .env.example .env.local   # then fill in the values (see below)
pnpm dev                     # http://localhost:3000
```

Environment variables (`.env.example`):

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project URL and anon key (Project Settings > API) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key; never expose to the browser |
| `DATABASE_URL` | Postgres connection string (used by scripts) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | From BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Random string you choose; Telegram echoes it on every webhook call |
| `TELEGRAM_ARCHIVE_CHAT_ID`, `TELEGRAM_STAFF_CHAT_ID` | Chat ids of the archive channel and the staff group |
| `APP_URL` | Public base URL of the deployment (https) |
| `E2E_SECRET` | Shared secret for the test-only login route used by E2E tests |

## Tests

```bash
pnpm lint && pnpm typecheck
pnpm test        # unit tests (Vitest)
pnpm test:db     # DB/RLS tests; starts a throwaway Postgres 16 cluster, applies migrations, always cleans up
pnpm test:e2e    # Playwright end-to-end tests
```

`pnpm test:db` uses `/usr/lib/postgresql/16/bin` by default; override with `PG_BIN` and `DB_TEST_PORT`.
CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit tests, DB tests and the build on every push and PR.

## Supabase project

1. Create a project at <https://supabase.com> (free tier is fine for testing).
2. Apply every file in `supabase/migrations/` in filename order (`0001_...sql`, `0002_...sql`, ...), either by pasting
   each into the SQL editor or with `psql "$DATABASE_URL" -1 -f supabase/migrations/NNNN_name.sql`.
3. Copy the URL, anon key and service-role key into the environment variables above.
4. **Security (required):** in Authentication > Providers > Email turn **off** "Allow new users to sign up". Users are
   created only by the bot with the service role; with public signup enabled an attacker could pre-register
   `tg_<telegram_id>@users.internal` for a victim before their first login.

## Telegram bot and chats

1. Open [@BotFather](https://t.me/BotFather), send `/newbot`, and store the token as `TELEGRAM_BOT_TOKEN` and the
   username as `TELEGRAM_BOT_USERNAME`. Optionally run `/setdomain` with your app domain for the Login Widget.
2. Create a **private archive channel** (student submissions are copied here so media survives) and a **staff
   group** (teachers/admins notifications). Add the bot to both; make it an admin of the channel.
3. Create one **curator group** per cohort/curator team and add the bot.
4. Get chat ids: add [@RawDataBot](https://t.me/RawDataBot) or [@getidsbot](https://t.me/getidsbot) temporarily and
   read the `chat.id` (private channels and supergroups look like `-100...`), or send a message in the chat and open
   `https://api.telegram.org/bot<TOKEN>/getUpdates` locally. Put the archive and staff ids in
   `TELEGRAM_ARCHIVE_CHAT_ID` / `TELEGRAM_STAFF_CHAT_ID`; curator group ids are stored in the database by the admin panel.
5. After deploying, register the webhook:

   ```bash
   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... APP_URL=https://your.domain pnpm telegram:set-webhook
   ```

   It calls `setWebhook` with `APP_URL/api/telegram/webhook`, the secret token and
   `allowed_updates: ["message", "callback_query"]`. The token is never printed. Re-run after every domain change.

## Managing students, cohorts and curators (`/teacher/students`, `/teacher/cohorts`, `/teacher/curators`)

- Writes go through service-role SQL functions (`manage_*`, migration 0017) that re-check the acting teacher/admin
  themselves; the actor always comes from the verified session. Reads use the user-scoped client, so another
  teacher's cohort is empty / 404.
- **Closing a cohort** sets `access_until = now()`: new requests find no open cohort and pending ones cannot be approved
  (`cohort_closed`); already active students keep their own expiry. Opening needs a future date. The bot assigns new
  requests to the newest open cohort, so the share link is the bot link (`t.me/<bot>`) / the site login page.
- **Curator role** is granted only by `manage_assign_curator`: the target needs a profile with a linked Telegram and
  no live student enrollment. Candidates are found by exact phone, Telegram id or @username.
- **Manual Telegram link** (profile has a phone but no `telegram_id`, so the bot refuses it as "phone taken"): the teacher
  enters the student's numeric Telegram id on the student page. It is accepted only if the Bot API `getChat` confirms a
  private chat with that user (the student must have pressed Start in the bot); the id is stored on the profile and
  mirrored into the auth user's `app_metadata`, which the login exchange requires. Usernames are not accepted
  (the Bot API cannot resolve them).

## Deployment

- **Testing:** Vercel Hobby works. Set all environment variables in the project settings, deploy, then set the webhook.
- **Real cohorts:** Vercel's free (Hobby) tier is not permitted for commercial use. Use a paid Vercel plan or another
  compatible Node host before running paid courses.
- **Rate limit (required):** add a platform rate limit on `POST /api/auth/telegram/start` (e.g. a Vercel Firewall
  rate-limit rule, about 10 requests/min/IP). The app deliberately has no in-memory limiter (meaningless on
  serverless); `/start` is unauthenticated and creates a database row per call.
- **GitHub Actions secrets:** `SUPABASE_URL` and `SUPABASE_ANON_KEY` (daily keepalive,
  `.github/workflows/keepalive.yml`, prevents free-tier pausing), `SUPABASE_DB_URL` (weekly `pg_dump` backup,
  `.github/workflows/backup.yml`, stored as a private workflow artifact for 90 days).
  Use the Supabase session-pooler or direct connection string for the dump.

## Copyright

Course PDFs, audio, video and other teaching media are copyrighted and are **never committed** to this repository.
They are imported locally (`pnpm content:import`) or uploaded through the teacher panel and live only in Supabase/Telegram.
Secrets (`.env*`, tokens, keys) are never committed either.
