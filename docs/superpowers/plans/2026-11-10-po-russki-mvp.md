# «По-русски говорим» MVP v0.1 — amalga oshirish rejasi

> **Bajaruvchilar uchun:** bu reja `subagent-driven-development` uslubida bajariladi:
> har bir vazifa — bitta yangi subagent, keyin vazifa bo'yicha review. Vazifalar
> **ketma-ket** bajariladi (parallel emas). Har vazifa o'z testlari va commit'i bilan tugaydi.

- **Spec (bog'lovchi manba):** `docs/superpowers/specs/2026-11-10-po-russki-platform-design.md`
- **Dizayn maketi:** «Sariq daftar» kanvasi — artboard nomlari quyida `[Artboard: X]` ko'rinishida.
- **Maqsad:** 1-modul (10 dars) + Test 1 bilan 20–30 o'quvchida sinovga tayyor PWA,
  ustoz/kurator paneli va Telegram bot.
- **Arxitektura:** bitta Next.js (App Router) loyihasi: o'quvchi ilovasi, ustoz/kurator
  paneli, bot webhook'i va server route'lari. Supabase: Postgres + Auth + Storage.

---

## 0. Global cheklovlar (har vazifaga tegishli)

1. **Spec ustun.** Reja va spec zid kelsa — spec to'g'ri.
2. **Stek va versiyalar:** Node 22, pnpm, Next.js 15 (App Router, `src/`), React 19,
   TypeScript `strict: true`, Tailwind CSS v4, `@supabase/supabase-js` 2.x, `@supabase/ssr`,
   `grammy` 1.x, `zod` 3.x, `lucide-react`, Vitest + Testing Library, Playwright
   (konteynerda oldindan o'rnatilgan — `playwright install` QILINMAYDI; `--trace off`).
3. **UI matni** — o'zbek (lotin), o'qitiladigan kontent — rus. Tutuq belgisi uchun `'` yoki `ʻ`,
   loyiha bo'ylab bir xil: `'`.
4. **Dizayn tokenlari (aynan shu qiymatlar)** `src/app/globals.css` `:root` da:
   ```
   --bg #FAF7EC; --card #FFFFFF; --surface-2 #F3EEDF; --border #E6E0CC; --border-strong #D9D3BC;
   --ink #1A1A17; --ink-2 #5F5B50; --ink-3 #6F6B60;
   --brand #FFD60A; --brand-shadow #C9A400; --brand-text #8A6A00;
   --fire #FF6B4A; --fire-shadow #C24A2F; --fire-text #B23A1E; --fire-bg #FFE3DB;
   --ok #3DDC84; --ok-shadow #24A35E; --ok-text #157A43; --ok-bg #DDF7E7;
   --info #3D7BEA; --info-strong #1F55B8; --info-bg #E3ECFC;
   --radius-sm 12px; --radius-md 16px; --radius-lg 20px; --radius-xl 24px;
   font-family: -apple-system, BlinkMacSystemFont, Inter, sans-serif;
   ```
   Sariq (`--brand`) hech qachon oq/krem fonda **matn rangi** bo'lmaydi (matn uchun `--brand-text`).
   Katak fon faqat `/` (xush kelibsiz) va `/path` ekranlarida: chiziq `#F0EBDA`, qadam 32px.
5. **Ikonkalar** faqat `lucide-react`. Emoji UI'da yo'q. Tegish maydoni ≥ 44×44px.
   Matn kontrasti ≥ 4.5:1. Ikonka-tugmalarda `aria-label`.
6. **Taktil tugma:** pastki soya `0 5px 0 <shadow>`, bosilganda `translateY(3px)` + soya 2px, 150ms.
7. **Xavfsizlik:** service role kalit va bot token faqat serverda (`server-only` import).
   To'g'ri javoblar klientga **hech qachon** yuborilmaydi. XP faqat serverda yoziladi.
8. **Vaqt zonasi:** kun hisobi `Asia/Tashkent`.
9. **Har bir jadval RLS yoqilgan.** Yangi jadval = yangi RLS testlari.
10. **Commit:** Conventional Commits (`feat:`, `fix:`, `test:`, `chore:`, `docs:`), har vazifa ≥ 1 commit.
    Kitob PDF'lari va media fayllar **commit qilinmaydi**.
11. **Holatlar:** har bir ma'lumot ko'rsatuvchi ekranda loading, empty va error holatlari bor.
12. **Tekshiruv buyruqlari** (har vazifa oxirida yashil bo'lishi shart):
    `pnpm lint && pnpm typecheck && pnpm test` (+ DB vazifalarida `pnpm test:db`).

## 1. Katalog tuzilmasi (T1 yaratadi, keyingilar to'ldiradi)

```
src/
  app/
    (public)/page.tsx                 # xush kelibsiz            [Artboard: Main]
    (public)/login/page.tsx           # kirish + kutish          [Artboard: Login]
    (student)/layout.tsx              # BottomNav
    (student)/home/page.tsx           #                          [Artboard: Home]
    (student)/path/page.tsx           #                          [Artboard: Path]
    (student)/lesson/[partId]/page.tsx#                          [Artboard: Lesson]
    (student)/words/page.tsx          #                          [Artboard: Flashcard]
    (student)/speak/[exerciseId]/page.tsx #                      [Artboard: Speaking]
    (student)/rating/page.tsx         #                          [Artboard: Leaderboard]
    (student)/test/[testId]/page.tsx
    (staff)/curator/page.tsx          #                          [Artboard: Curator]
    (staff)/teacher/page.tsx          #                          [Artboard: TeacherDashboard]
    (staff)/teacher/lessons/[lessonId]/page.tsx #                [Artboard: TeacherLessonEditor]
    (staff)/teacher/students/page.tsx
    (staff)/teacher/tests/page.tsx
    api/telegram/webhook/route.ts
    api/auth/telegram/{start,status,exchange}/route.ts
    api/attempts/route.ts
    api/srs/grade/route.ts
    api/submissions/{audio-upload,audio-complete}/route.ts
    api/media/tg/[submissionId]/route.ts
    api/reviews/route.ts
  components/ui/        # Button, Card, Chip, ProgressBar, IconButton, Sheet, Tabs, Avatar
  components/student/   # BottomNav, StatTile, WeekStrip, ContinueCard, ...
  components/exercises/ # Classify, FillBlank, Conjugate, Choose, Match, FeedbackSheet
  components/staff/     # Sidebar, KpiTile, ActivityChart, ...
  lib/supabase/{browser,server,service}.ts
  lib/env.ts
  lib/exercises/{types,normalize,check}.ts
  lib/gamification/{xp,streak,day}.ts
  lib/srs.ts
  lib/path-status.ts
  lib/telegram/{bot,handlers/*,keyboards,api}.ts
  server/  # server-only servislar: attempts.ts, reviews.ts, enrollment.ts, auth.ts
supabase/
  migrations/0001_identity.sql ... 
  tests/shim.sql                # Supabase'siz lokal Postgres uchun auth sxema shim'i
  seed.sql
content/module-1/lesson-XX.json  # kontent manbasi (import skripti bilan bazaga)
scripts/{db-test.sh,content-import.ts,set-webhook.ts}
tests/{db,unit,integration,e2e}/
```

---

## 2. Vazifalar

Bog'liqliklar har vazifada `Depends:` qatorida. Model tavsiyasi: `[cheap]` — to'liq
ko'rsatilgan transkripsiya, `[standard]` — bir necha fayl/integratsiya, `[capable]` — dizayn qarori.

---

### Task 1: Loyiha karkasi `[standard]`

**Depends:** —
**Files:** `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`,
`vitest.setup.ts`, `playwright.config.ts`, `src/app/layout.tsx`, `src/app/globals.css`,
`src/app/(public)/page.tsx` (vaqtincha), `.env.example`, `.gitignore`, `README.md`.

- [ ] `pnpm create next-app` ekvivalentini qo'lda yoki CLI bilan: TS, App Router, `src/`, Tailwind v4, ESLint.
- [ ] `package.json` skriptlari aynan:
  `dev`, `build`, `start`, `lint` (`next lint` yoki `eslint .`), `typecheck` (`tsc --noEmit`),
  `test` (`vitest run --project unit`), `test:db` (`bash scripts/db-test.sh`),
  `test:e2e` (`playwright test --trace off`), `content:import` (`tsx scripts/content-import.ts`).
- [ ] Vitest ikki project: `unit` (`tests/unit/**`, `src/**/*.test.ts(x)`, jsdom) va `db` (`tests/db/**`, node).
- [ ] `.gitignore`: `.env*` (`.env.example` dan tashqari), `*.pdf`, `/content/private/`, `.superpowers/`.
- [ ] `.env.example` — Task 10 dagi `env.ts` ro'yxatidagi barcha o'zgaruvchilar (+ `DATABASE_URL`, `E2E_SECRET`), qiymatsiz.
- [ ] `globals.css` — 0-bo'lim 4-banddagi tokenlar (aynan), `body { background: var(--bg); color: var(--ink) }`.
- [ ] `layout.tsx`: `<html lang="uz">`, Inter `next/font/google` (`subsets: ['latin','cyrillic']`,
  `variable: '--font-inter'`), shrift steki 0-bo'limdagi kabi; `viewport` `themeColor: '#FAF7EC'`.
- [ ] Bitta smoke test `tests/unit/smoke.test.ts` (`expect(1+1).toBe(2)` emas — `globals.css`
  tokenlari mavjudligini fayldan o'qib tekshiradi: `--brand: #FFD60A` va boshqalar).
- [ ] Tekshiruv: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` yashil.
- [ ] Commit: `chore: scaffold Next.js app with tokens and test tooling`.

---

### Task 2: UI primitivlari `[standard]`

**Depends:** T1
**Files:** `src/components/ui/{Button,IconButton,Card,Chip,ProgressBar,Tabs,Sheet,Avatar,Skeleton,EmptyState,ErrorState}.tsx`,
`src/components/ui/index.ts`, `src/app/dev/ui/page.tsx` (faqat `NODE_ENV !== 'production'` da render), testlar.

- [ ] `Button` variantlari: `primary` (brand fon, `--ink` matn, `--brand-shadow`), `secondary`
  (`--surface-2` fon, `--border-strong` chegara/soya), `success` (ok), `danger` (fire), `dark` (`--ink` fon, `--brand` matn).
  O'lchamlar: `md` 48px, `lg` 56px. `asChild` emas — `href` berilsa `<Link>` render qiladi. `loading` holati (spinner + `aria-busy`).
- [ ] `IconButton`: 44×44, `aria-label` majburiy prop (TS darajasida).
- [ ] `ProgressBar`: `value`, `max`, `role="progressbar"` + aria qiymatlari; rang prop'i (`brand|ok|info|fire`).
- [ ] `Tabs`: `role="tablist"`/`tab`, `aria-selected`, klaviatura chap/o'ng.
- [ ] `Sheet`: pastdan chiqadigan panel (feedback uchun), `variant: 'ok'|'error'`.
- [ ] `EmptyState`/`ErrorState`: ikonka + sarlavha + matn + ixtiyoriy amal tugmasi.
- [ ] Testing Library testlari: Button `href` bilan `<a>` beradi; `loading` da `disabled`;
  IconButton aria-label; Tabs klaviatura navigatsiyasi; ProgressBar aria qiymatlari.
- [ ] `/dev/ui` sahifasi — barcha komponentlar ko'rgazmasi (vizual tekshiruv uchun).
- [ ] Commit: `feat(ui): add design-system primitives`.

---

### Task 3: Lokal DB test muhiti `[standard]`

**Depends:** T1
**Files:** `scripts/db-test.sh`, `supabase/tests/shim.sql`, `tests/db/helpers.ts`, `tests/db/harness.test.ts`.

Konteynerda Postgres 16 bor (`/usr/lib/postgresql/16`). Supabase CLI/Docker'ga tayanmaymiz.

- [ ] `scripts/db-test.sh`: vaqtinchalik `PGDATA` (`mktemp -d`) → `initdb` → `pg_ctl start -o "-p 54329 -k /tmp"`
  → `createdb rustili_test` → `shim.sql` → `supabase/migrations/*.sql` (nom tartibida) → `vitest run --project db`
  → `pg_ctl stop` (trap bilan har doim). `DATABASE_URL=postgres://$(whoami)@localhost:54329/rustili_test`.
  Root ostida ishlasa `postgres` foydalanuvchisi orqali (`su postgres -c`) ishga tushiradi.
- [ ] `shim.sql` — Supabase muhitini taqlid qiladi:
  ```sql
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, created_at timestamptz default now());
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create or replace function auth.role() returns text language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  create schema if not exists storage; -- storage siyosatlari testda tekshirilmaydi
  ```
- [ ] `tests/db/helpers.ts`:
  `withUser(uid: string | null, fn: (q) => Promise<T>)` — tranzaksiya ichida
  `set local role authenticated|anon`, `set local request.jwt.claim.sub = uid`; oxirida rollback.
  `asService(fn)` — `set local role service_role`. `createUser(email)` → `auth.users` ga qo'shadi va `id` qaytaradi.
- [ ] `harness.test.ts`: `withUser(x)` ichida `auth.uid()` = x; `withUser(null)` da `auth.role()` = `'anon'`.
- [ ] Commit: `test(db): add local Postgres harness with Supabase auth shim`.

---

### Task 4: Migratsiya 0001 — identifikatsiya va kirish `[capable]`

**Depends:** T3
**Files:** `supabase/migrations/0001_identity.sql`, `tests/db/identity.test.ts`.

- [ ] Enumlar: `user_role ('student','curator','teacher','admin')`,
  `enrollment_status ('pending','active','rejected','expired')`, `enrollment_source ('manual','payme','click')`,
  `nonce_status ('created','confirmed','consumed')`.
- [ ] Jadvallar (spec §6): `profiles`, `courses`, `cohorts`, `curator_groups`, `enrollments`, `login_nonces`.
  - `profiles.id references auth.users on delete cascade`, `telegram_id bigint unique`, `phone text unique`, `role user_role not null default 'student'`.
  - `enrollments unique (student_id, cohort_id)`.
  - `login_nonces(nonce text pk, telegram_id bigint, status nonce_status default 'created', expires_at timestamptz not null, created_at)`.
- [ ] Yordamchi funksiyalar (`security definer`, `stable`, `set search_path = public`):
  `app_role() returns user_role`, `is_staff() → teacher|admin`,
  `teaches_course(course uuid) → bool`, `active_course_ids() → setof uuid` (o'quvchining
  `status='active' and (expires_at is null or expires_at > now())` enrollment'lari bo'yicha),
  `curated_student_ids() → setof uuid` (joriy kurator guruhlaridagi o'quvchilar).
- [ ] RLS:
  - `profiles`: o'zi o'qiydi/yangilaydi (faqat `full_name`; `role`,`phone`,`telegram_id` ni o'zgartira olmaydi — trigger yoki column grant bilan);
    kurator o'z o'quvchilarini o'qiydi; staff hammasini o'qiydi.
  - `courses/cohorts`: faol o'quvchi o'z kursini o'qiydi; ustoz o'z kursini to'liq boshqaradi; admin hammasini.
  - `curator_groups`: kurator o'z guruhini, ustoz o'z kursidagilarni.
  - `enrollments`: o'quvchi o'zinikini o'qiydi (yoza olmaydi); ustoz o'z kursidagilarni boshqaradi.
  - `login_nonces`: `anon`/`authenticated` uchun hech qanday ruxsat yo'q (faqat service role).
- [ ] Testlar (har biri alohida `it`): o'quvchi boshqa o'quvchi profilini ko'rmaydi; o'quvchi o'z
  `role` ini `teacher` qila olmaydi; kurator faqat o'z guruhi o'quvchilarini ko'radi; ustoz A ustoz B kursini ko'rmaydi;
  `pending` o'quvchi kursni ko'rmaydi, `active` ko'radi, muddati o'tgan `active` ko'rmaydi; anon `login_nonces` ni o'qiy olmaydi.
- [ ] Commit: `feat(db): identity, cohorts, enrollments with RLS`.

---

### Task 5: Migratsiya 0002 — kontent `[capable]`

**Depends:** T4
**Files:** `supabase/migrations/0002_content.sql`, `tests/db/content.test.ts`.

- [ ] Enumlar: `part_kind ('grammar','conversation')`,
  `block_type ('video','audio','rule_image','text','reading','exercise','speaking','words')`,
  `exercise_type ('classify','fill_blank','conjugate','choose','match','arrange','listen_pick','open_text','speaking')`,
  `check_mode ('auto','review')`, `test_section ('vocab','grammar','reading','listening','writing')`.
- [ ] Jadvallar: `modules`, `lessons`, `lesson_parts`, `blocks`, `exercises`, `words`, `lesson_words`, `texts`, `tests`, `test_items`.
  `blocks.published boolean default false`, `(lesson_part_id, position) unique deferrable initially deferred` (qayta tartiblash uchun).
- [ ] **Ruling (spec §6/§7 aniqlashtirish):** to'g'ri javob `exercises.answer` ustunida emas,
  alohida `exercise_keys(exercise_id pk references exercises on delete cascade, answer jsonb not null)`
  jadvalida. Unda o'quvchilar uchun **hech qanday** select siyosati yo'q; staff o'qiydi/yozadi.
  Sabab: RLS ustunlarni yashirmaydi; spec talabi "javob klientga yuborilmaydi" shunda kafolatlanadi.
- [ ] RLS: o'quvchi faqat `active_course_ids()` dagi kursning **nashr qilingan** bloklari/mashqlarini o'qiydi;
  ustoz o'z kursini to'liq boshqaradi; kurator o'z kohortasi kursini o'qiydi (javob kalitlarisiz).
- [ ] Testlar: faol o'quvchi nashr qilingan blokni ko'radi, qoralamani ko'rmaydi; `exercise_keys`
  dan o'quvchi 0 qator oladi; boshqa kurs o'quvchisi hech narsa ko'rmaydi; ustoz blok tartibini
  bitta tranzaksiyada almashtira oladi (deferrable unique).
- [ ] Commit: `feat(db): course content schema with hidden answer keys`.

---

### Task 6: Migratsiya 0003 — progress, topshiriqlar, baholar `[capable]`

**Depends:** T5
**Files:** `supabase/migrations/0003_progress.sql`, `tests/db/progress.test.ts`.

- [ ] Enumlar: `part_status ('in_progress','completed')`, `submission_kind ('audio','video','text')`,
  `submission_status ('pending','reviewed')`, `review_channel ('web','telegram')`.
- [ ] Jadvallar: `part_progress (pk student_id, lesson_part_id)`, `attempts`, `submissions`
  (+ `draft_scores jsonb not null default '{}'` — Telegram'da bosqichma-bosqich baholash uchun),
  `reviews` (`scores jsonb` kalitlari aynan: `completeness`,`pronunciation`,`grammar`,`fluency`; har biri 1..5,
  `check` cheklovi bilan; `total numeric(3,2)`), `srs_cards (pk student_id, word_id)`, `test_attempts`.
- [ ] RLS: o'quvchi o'z qatorlarini o'qiydi; **yozish** — `attempts`, `reviews`, `xp` uchun faqat service role
  (server route'lar orqali). O'quvchi `srs_cards` va `part_progress` ga ham to'g'ridan-to'g'ri yozmaydi (server orqali).
  Kurator `curated_student_ids()` ning `submissions`/`reviews` ini o'qiydi; staff hammasini.
- [ ] Testlar: o'quvchi o'zgasining submission'ini ko'rmaydi; kurator boshqa guruh submission'ini ko'rmaydi;
  o'quvchi `reviews` ga insert qila olmaydi; `scores` da 6 qiymati rad etiladi.
- [ ] Commit: `feat(db): progress, submissions and reviews with RLS`.

---

### Task 7: Migratsiya 0004 — gamifikatsiya `[capable]`

**Depends:** T6
**Files:** `supabase/migrations/0004_gamification.sql`, `tests/db/gamification.test.ts`.

- [ ] `xp_reason` enum: `'exercise_correct','part_completed','speaking_reviewed','daily_tasks','streak_bonus','test_completed'`.
- [ ] `xp_events(id, student_id, amount int check (amount > 0), reason xp_reason, ref_id text not null, created_at,
  unique (student_id, reason, ref_id))`.
- [ ] `daily_activity(student_id, day date, xp int default 0, tasks jsonb default '{}', pk (student_id, day))`.
- [ ] `award_xp(p_student uuid, p_amount int, p_reason xp_reason, p_ref text) returns boolean`
  — `security definer`, faqat `service_role` ga `execute`. `on conflict do nothing`; yangi qator bo'lsa
  `daily_activity` (`day = (now() at time zone 'Asia/Tashkent')::date`) ga `xp` qo'shadi; `true/false` qaytaradi.
- [ ] `achievements` + `student_achievements` (seed: `first_lesson`,`words_100`,`streak_7`,`grammar_master`,`listening_champion`,`speaking_champion`).
- [ ] View'lar (`security_invoker = true` emas — `security definer` funksiya orqali beriladi, chunki o'quvchi
  boshqalarning XP'sini to'g'ridan-to'g'ri o'qimaydi):
  `leaderboard(p_cohort uuid, p_kind text /*'xp'|'speaking'*/, p_period text /*'week'|'month'*/)
   returns table(rank int, student_id uuid, display_name text, score numeric, eligible boolean)`.
  - Hafta: dushanba 00:00 Asia/Tashkent'dan; oy: oyning 1-kunidan.
  - `speaking`: davr ichidagi har submission'ning **oxirgi** review `total` o'rtachasi; `eligible = count >= 8`;
    tartib: eligible birinchi, keyin o'rtacha desc, keyin count desc.
  - `display_name`: `full_name` ning birinchi so'zi + familiyaning bosh harfi (`Madina R.`).
  - Chaqiruvchi shu kohortada faol bo'lishi yoki staff bo'lishi shart, aks holda bo'sh.
- [ ] Testlar: bir xil `ref_id` bilan `award_xp` ikki marta → ikkinchisi `false`, XP bir marta;
  Toshkent vaqti 23:30 UTC-dagi hodisa ertangi kunga yoziladi; speaking reytingida 7 ta topshirig'i borlar `eligible=false`;
  begona kohorta o'quvchisi reytingni ko'rmaydi.
- [ ] Commit: `feat(db): xp ledger, daily activity and leaderboards`.

---

### Task 8: Mashq tekshiruvchilari (sof TS) `[standard]`

**Depends:** T1
**Files:** `src/lib/exercises/{types,normalize,check}.ts`, `src/lib/exercises/check.test.ts`.

- [ ] `types.ts` — har tur uchun `Payload` (klientga boradi), `Key` (serverda), `Answer` (klientdan):

| type | Payload | Key | Answer |
|---|---|---|---|
| `classify` | `{ items: {id, text}[], buckets: {id, label, hint?}[] }` | `{ [itemId]: bucketId }` | `{ itemId, bucketId }` (bitta element, darhol feedback) |
| `fill_blank` | `{ items: {id, before, after, hint?}[] }` | `{ [itemId]: string[] }` (qabul qilinadigan variantlar) | `{ itemId, value }` |
| `conjugate` | `{ verb, pronouns: ['я','ты','он/она','мы','вы','они'] }` | `{ forms: string[6] }` | `{ forms: string[6] }` |
| `choose` | `{ items: {id, text, options: string[]}[] }` | `{ [itemId]: number }` | `{ itemId, index }` |
| `match` | `{ left: {id,text}[], right: {id,text}[] }` | `{ [leftId]: rightId }` | `{ pairs: [leftId, rightId][] }` |

- [ ] `normalize(s)`: trim, ichki bo'shliqlarni bittaga, kichik harf, `ё→е`, urg'u belgisi `́` ni olib tashlash,
  oxiridagi `.`/`!`/`?` ni olib tashlash.
- [ ] `check(type, key, answer) → { correct: boolean, expected?: unknown, perItem?: boolean[] }`.
  `conjugate` uchun `perItem` 6 ta; `correct` — hammasi to'g'ri bo'lsa.
- [ ] Testlar (aynan shu holatlar):
  - classify: `тетрадь→f` to'g'ri; `тетрадь→m` xato, `expected: 'f'`.
  - fill_blank: kalit `['гуляет']`, javob `' Гуляет. '` → to'g'ri; `'гуляют'` → xato; kalit `['её','ее']` va javob `'ее'` → to'g'ri.
  - conjugate `работать`: `['работаю','работаешь','работает','работаем','работаете','работают']` → to'g'ri;
    3-shakl `работает́` (urg'u bilan) → to'g'ri; 6-shakl `работаут` → `perItem[5] === false`.
  - choose: index mos/mos emas.
  - match: barcha juftlar to'g'ri → to'g'ri; bitta almashgan → xato.
  - noma'lum `type` → xato tashlaydi.
- [ ] Commit: `feat(exercises): answer normalization and checkers`.

---

### Task 9: Gamifikatsiya va SRS sof funksiyalari `[cheap]`

**Depends:** T1
**Files:** `src/lib/gamification/{day,xp,streak}.ts`, `src/lib/srs.ts`, `src/lib/path-status.ts`, `*.test.ts`.

- [ ] `day.ts`: `tashkentDay(d: Date): string` (`YYYY-MM-DD`, `Asia/Tashkent`, `Intl` orqali).
- [ ] `xp.ts` — konstantalar aynan:
  `EXERCISE_FIRST = 10`, `EXERCISE_RETRY = 5`, `PART_COMPLETED = 20`, `DAILY_TASKS = 30`,
  `STREAK_BONUS = {7:50, 14:100, 30:200}`, `speakingXp(total) = Math.round(40 * total / 5)`,
  `testXp(percent) = Math.round(percent * 2)`.
- [ ] `streak.ts`: `currentStreak(days: string[], today: string): number` — ketma-ket kunlar;
  bugun faollik bo'lmasa, kechagi kundan boshlab sanaydi (streak hali "yonib turibdi").
  Testlar: `[]→0`; bugun+kecha+o'tgan kun → 3; faqat kecha → 1; kecha yo'q, o'tgan kun bor → 0.
- [ ] `srs.ts` — `grade(card, g: 'again'|'hard'|'good', now): card`:
  - yangi karta: `interval_days=0, ease=2.5, reps=0, lapses=0`.
  - `again`: `due = now + 10 min`, `reps=0`, `lapses+1`, `ease = max(1.3, ease-0.2)`.
  - `hard`: `interval = max(1, round(interval*1.2))`, `ease = max(1.3, ease-0.15)`, `due = now + interval kun`.
  - `good`: `reps==0 → interval=1`; `reps==1 → 4`; aks holda `round(interval*ease)`; `due = now + interval kun`; `reps+1`.
  - Testlar: yangi→good = 1 kun; ikkinchi good = 4 kun; uchinchi good (ease 2.5) = 10 kun; again ease'ni 1.3 dan pastga tushirmaydi.
- [ ] `path-status.ts` — `computePathStatus(parts: {id, order}[], progress: Map<id,'in_progress'|'completed'>)`
  → har qism uchun `'locked'|'available'|'in_progress'|'completed'`. Qoida: birinchi tugallanmagan qism —
  `in_progress` (agar progress bor) yoki `available`; undan keyingilari `locked`; oldingilari `completed`.
  Dars holati: ikkala qism completed → completed; birortasi in_progress/available → o'sha; aks holda locked.
  Test: modul testi faqat 10 ta darsning hammasi completed bo'lsa `available`.
- [ ] Commit: `feat(lib): xp, streak, srs and path status logic`.

---

### Task 10: Supabase klientlari, env va guard'lar `[standard]`

**Depends:** T4
**Files:** `src/lib/env.ts`, `src/lib/supabase/{browser,server,service}.ts`, `src/middleware.ts`,
`src/server/guards.ts`, testlar.

- [ ] `env.ts` (zod): serverda `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
  `TELEGRAM_BOT_USERNAME`, `TELEGRAM_ARCHIVE_CHAT_ID`, `TELEGRAM_STAFF_CHAT_ID`, `APP_URL`;
  klientda `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Noto'g'ri env → aniq xato xabari.
- [ ] `service.ts` — `import 'server-only'`.
- [ ] `middleware.ts` — `@supabase/ssr` sessiya yangilash; `/home`, `/path`, ... (student) va `/curator`, `/teacher` himoyalangan.
- [ ] `guards.ts`: `requireStudent()` (faol enrollment yo'q → `/login?state=pending`), `requireCurator()`, `requireStaff()`.
- [ ] Testlar: env sxemasi (yetishmayotgan kalit → xato); guard'lar mock klient bilan to'g'ri redirect qiladi.
- [ ] Commit: `feat(auth): supabase clients, env validation and route guards`.

---

### Task 11: Telegram bot yadrosi + login handler `[capable]`

**Depends:** T10
**Files:** `src/lib/telegram/{bot,api,keyboards}.ts`, `src/lib/telegram/handlers/login.ts`,
`src/app/api/telegram/webhook/route.ts`, `tests/integration/telegram-login.test.ts`, `tests/fixtures/telegram/*.json`.

- [ ] `bot.ts`: grammY `Bot` (lazy singleton), `webhookCallback(bot, 'std/http')`.
  Route: `X-Telegram-Bot-Api-Secret-Token !== TELEGRAM_WEBHOOK_SECRET` → 401.
- [ ] `/start login_<nonce>`: nonce bazada `created` va muddati o'tmagan bo'lishi kerak → botda
  "Telefon raqamingizni ulashing" + `request_contact` klaviaturasi (bir martalik, resize). Aks holda
  "Havola eskirgan, saytdan qayta urinib ko'ring".
- [ ] `message:contact`: `contact.user_id !== from.id` → rad ("Faqat o'z raqamingizni ulashing").
  To'g'ri bo'lsa (service klient): `auth.users` da `tg_<id>@users.internal` bo'yicha topish/yaratish,
  `profiles` upsert (`telegram_id`, `phone` E.164, `full_name` = first+last), oxirgi `created` nonce'ni `confirmed` +
  `telegram_id` bilan belgilash, foydalanuvchiga "Saytga qayting" xabari, klaviaturani olib tashlash.
- [ ] Testlar: grammY'ni Bot API'ga chiqmasdan sinash (`bot.api.config.use` transformer bilan chaqiruvlarni yozib olish,
  `botInfo` ni qo'lda berish). Holatlar: noto'g'ri secret → 401; eskirgan nonce; begona kontakt rad; to'g'ri kontakt →
  profil yaratildi + nonce confirmed. DB uchun service klient mock yoki `test:db` muhiti (`tests/integration` db project'da).
- [ ] Commit: `feat(bot): telegram webhook and contact-based login`.

---

### Task 12: Web login oqimi `[standard]`

**Depends:** T11, T2
**Files:** `src/app/(public)/page.tsx`, `src/app/(public)/login/page.tsx`,
`src/app/api/auth/telegram/{start,status,exchange}/route.ts`, `src/server/auth.ts`, testlar.

- [ ] `POST /start` → `{ nonce, deepLink: 'https://t.me/<bot>?start=login_<nonce>', expiresAt }` (nonce: 24 bayt base64url, 10 daqiqa).
- [ ] `GET /status?nonce=` → `{ status: 'created'|'confirmed'|'expired' }` (nonce egasiga oid ma'lumot qaytarmaydi).
- [ ] `POST /exchange {nonce}` → faqat `confirmed` bo'lsa: nonce → `consumed` (atomik `update ... where status='confirmed' returning`),
  `auth.admin.generateLink({type:'magiclink', email})` → `{ tokenHash }`. Klient `verifyOtp({ token_hash, type: 'magiclink' })`.
- [ ] `/` sahifa `[Artboard: Main]`: brand chip, «Я/Ж/Ы» plitkalari (Я — `--ink` fon), sarlavha, "Telegram orqali kirish" tugmasi.
- [ ] `/login` `[Artboard: Login]`: 3 qadamli holat (botni ochish → raqam → ruxsat), har 2 soniyada status so'rash,
  muvaffaqiyatda `exchange` → `/home`; enrollment `pending` bo'lsa "Ustoz tasdig'i kutilmoqda" holati.
- [ ] Testlar: `exchange` ikki marta chaqirilsa ikkinchisi 409; `created` nonce bilan 409; muddati o'tgani 410.
- [ ] Commit: `feat(auth): telegram deep-link login flow`.

---

### Task 13: Kursga ruxsat (enrollment) `[standard]`

**Depends:** T12
**Files:** `src/server/enrollment.ts`, `src/lib/telegram/handlers/enrollment.ts`, testlar.

- [ ] Kontakt tasdiqlanganda faol/pending enrollment yo'q bo'lsa → eng so'nggi ochiq kohortaga `pending` yaratiladi
  va `TELEGRAM_STAFF_CHAT_ID` ga xabar: `Yangi o'quvchi: <ism>, <telefon>` + tugmalar
  `callback_data`: `enr:approve:<enrollmentId>` / `enr:reject:<enrollmentId>`.
- [ ] `approveEnrollment(enrollmentId, actorProfileId, curatorGroupId?)`: actor `teacher|admin` va kurs egasi bo'lishi shart;
  `curatorGroupId` berilmasa — kohortadagi eng kam faol o'quvchili guruh (teng bo'lsa nom bo'yicha birinchi);
  `status='active'`, `approved_by/at`, `expires_at = cohort.access_until`; o'quvchiga bot xabari "Kurs ochildi!".
- [ ] Callback: bosgan foydalanuvchining `telegram_id` → profil → huquq tekshiruvi; xabar matni
  "Ruxsat berildi: <ism> → <guruh> (<kim>)" ga tahrirlanadi, tugmalar olinadi. Takroriy bosish — idempotent.
- [ ] Testlar: huquqsiz foydalanuvchi callback'i rad; avtomatik guruh tanlash; ikki marta approve → bitta o'zgarish.
- [ ] Commit: `feat(enrollment): approval via bot and server`.

---

### Task 14: Urinishlar API (submit_attempt) `[capable]`

**Depends:** T7, T8, T9, T10
**Files:** `src/server/attempts.ts`, `src/app/api/attempts/route.ts`, `src/server/progress.ts`, `tests/integration/attempts.test.ts`.

- [ ] `POST /api/attempts` `{ exerciseId, answer }` → `{ correct, expected?, perItem?, xpAwarded, partCompleted? }`.
- [ ] Oqim: sessiya → `requireStudent` → mashq o'quvchining faol kursida va nashr qilinganmi (user klient bilan o'qish — RLS tekshiradi)
  → `exercise_keys` service klient bilan → `check()` → `attempts` insert →
  to'g'ri bo'lsa `award_xp(student, first ? 10 : 5, 'exercise_correct', exerciseId + ':' + itemId|'all')`.
  "First" = shu `ref` uchun avval to'g'ri attempt yo'q.
- [ ] `completePart(student, partId)` (`progress.ts`): qismdagi barcha `auto` mashqlar kamida bir marta to'g'ri bo'lsa
  `part_progress.completed` + `award_xp(20,'part_completed', partId)`. Speaking/open_text yuborilgan bo'lishi kifoya (baholanishi shart emas).
- [ ] `expected` faqat javob **xato** bo'lganda qaytariladi (o'qitish uchun).
- [ ] Testlar: noto'g'ri kurs mashqi → 404; javob kaliti hech qachon to'g'ri javobdan oldin javobda yo'q;
  ikkinchi to'g'ri urinish 5 XP; bir xil element uchun uchinchi to'g'ri urinish 0 XP; qism tugashi 20 XP bir marta.
- [ ] Commit: `feat(api): server-side attempt checking and xp`.

---

### Task 15: O'quvchi qobig'i va bosh sahifa `[standard]`

**Depends:** T2, T9, T14
**Files:** `src/app/(student)/layout.tsx`, `src/app/(student)/home/page.tsx`,
`src/components/student/{BottomNav,StatTile,WeekStrip,ContinueCard,DailyTasks,ReviewDueCard}.tsx`,
`src/server/dashboard.ts`, testlar.

- [ ] `BottomNav` `[Artboard: Home]`: 5 ta (Asosiy `/home`, Yo'l `/path`, So'zlar `/words`, Reyting `/rating`,
  Gapirish — oxirgi ochiq speaking topshirig'i yoki `/path`). Faol element — sariq kapsula, `aria-current="page"`.
  Oq fon, `--border`, `safe-area-inset-bottom`.
- [ ] `getDashboard(studentId)` bitta server funksiya: ism, kohorta/guruh nomi, streak, jami XP, haftalik o'rin,
  hafta kunlari (Du..Ya, bajarilgan/bugun), joriy qism (dars nomi, kun turi, foiz), kunlik vazifalar
  (so'zlar 10, grammatika 1, audio 1, gapirish 1 — `daily_activity.tasks` dan), takrorlashga tayyor so'zlar soni.
- [ ] Loading skeleton, yangi o'quvchi uchun empty holat ("Birinchi darsni boshlang"), xato holati.
- [ ] Testlar: `getDashboard` (DB fixture bilan) va komponentlar render testlari (bugungi kun belgisi, 0 so'z holati).
- [ ] Commit: `feat(student): app shell and home dashboard`.

---

### Task 16: O'quv yo'li `[standard]`

**Depends:** T15
**Files:** `src/app/(student)/path/page.tsx`, `src/components/student/{PathNode,ModuleHeader}.tsx`, testlar.

- [ ] `[Artboard: Path]`: modul sarlavha kartasi (`--ink` fon, "1-MODUL", progress), zigzag tugunlar
  (siljishlar `[-70, 40, 70, -20, -80, 10]` takrorlanadi), har tugunda 2 ta kun indikatori, holat ranglari va ikonkalari
  (completed — ok + `Check`, current — brand + `Play` + "Davom etish · N-kun" yorlig'i, available — oq + `Star`,
  locked — `--surface-2` + `Lock`), oxirida Test tuguni (`Trophy`). Katak fon (0-bo'lim 4-band).
- [ ] Tugun bosilganda: available/in_progress → `/lesson/<partId>`; locked → toast "Avval oldingi darsni tugating".
- [ ] Holatlar `computePathStatus` (T9) dan.
- [ ] Testlar: locked tugun link emas (`button` + `aria-disabled`); current tugunda yorliq.
- [ ] Commit: `feat(student): learning path`.

---

### Task 17: Dars pleyeri va blok rendererlari `[standard]`

**Depends:** T16
**Files:** `src/app/(student)/lesson/[partId]/page.tsx`, `src/components/lesson/{LessonPlayer,blocks/*}.tsx`, testlar.

- [ ] Yuqorida yopish tugmasi + progress (`joriy blok / jami`). Bloklar ketma-ket; "Keyingisi" tugmasi.
- [ ] Rendererlar: `video` (YouTube `youtube-nocookie.com` embed, `title` majburiy), `audio` (`<audio controls>`,
  signed URL server komponentda, 1 soat), `rule_image` (`next/image`, kattalashtirish), `text`/`reading`
  (so'zga bosilganda `lesson_words` dan tarjima popover), `words` (`/words?lesson=` ga havola),
  `exercise` (T18 komponentlari), `speaking` (`/speak/<exerciseId>` ga karta).
- [ ] Oxirgi blokdan keyin `completePart` → natija ekrani (+XP, "Yo'lga qaytish").
- [ ] Testlar: blok tartibi; oxirgi blokda tugatish chaqiriladi; reading popover tarjimani ko'rsatadi.
- [ ] Commit: `feat(student): lesson player and block renderers`.

---

### Task 18: Mashq komponentlari `[standard]`

**Depends:** T17
**Files:** `src/components/exercises/{Classify,FillBlank,Conjugate,Choose,Match,FeedbackSheet,useAttempt}.tsx`, testlar.

- [ ] `[Artboard: Lesson]`: so'z kartasi (oq, `--border`, talaffuz tugmasi — `speechSynthesis` `ru-RU`, mavjud bo'lmasa yashiriladi),
  javob tugmalari ≥ 104px balandlik. `FeedbackSheet`: to'g'ri — `--ok-bg`, "Zo'r! +10 XP"; xato — `--fire-bg`,
  "Deyarli!" + to'g'ri javob + izoh.
- [ ] `useAttempt(exerciseId)` — `POST /api/attempts`, optimistik emas (server javobini kutadi, tugma `loading`).
- [ ] `Conjugate`: 6 ta input, har biri o'z natijasini ko'rsatadi (`perItem`).
- [ ] `Match`: ikki ustun, tanlangan juftlik bir zumda tekshiriladi.
- [ ] Klaviatura bilan to'liq ishlaydi (Tab/Enter), xatoda fokus feedback'ga o'tadi.
- [ ] Testlar (fetch mock): har komponent to'g'ri/xato feedback; tarmoq xatosi → "Qayta urinish".
- [ ] Commit: `feat(exercises): interactive exercise components`.

---

### Task 19: So'zlar va SRS `[standard]`

**Depends:** T18
**Files:** `src/app/(student)/words/page.tsx`, `src/app/api/srs/grade/route.ts`, `src/server/srs.ts`,
`src/components/student/Flashcard.tsx`, testlar.

- [ ] Tugallangan darslarning `lesson_words` i o'quvchi uchun `srs_cards` ga avtomatik qo'shiladi (`completePart` ichida — T14 faylini kengaytirish).
- [ ] Navbat: `due_at <= now()` lar, keyin yangi kartalar (kuniga 10 ta yangi). `[Artboard: Flashcard]`:
  segmentli progress, karta (rod chip, "Qiyin so'z" toggle, so'z, urg'u, audio, bosilganda tarjima + misol),
  tugmalar Qayta (10 daq) / Qiyin (… kun) / Bildim (… kun) — keyingi interval `srs.grade` dan hisoblab ko'rsatiladi.
- [ ] `POST /api/srs/grade {wordId, grade}` → serverda `grade()` + yangi so'zni o'rganish `daily_activity.tasks.words` ga +1.
- [ ] Testlar: interval yorliqlari; grade API karta yangilaydi; boshqa o'quvchining so'zi → 404.
- [ ] Commit: `feat(words): flashcards with spaced repetition`.

---

### Task 20: Gapirish — ovoz yozish `[standard]`

**Depends:** T19
**Files:** `src/app/(student)/speak/[exerciseId]/page.tsx`, `src/components/speaking/{Recorder,Waveform}.tsx`,
`src/app/api/submissions/{audio-upload,audio-complete}/route.ts`, Storage bucket migratsiyasi `0005_storage.sql`, testlar.

- [ ] Bucket `submissions` (private). Yo'l: `<studentId>/<submissionId>.webm`. Siyosat: o'quvchi faqat o'z papkasiga yuklaydi
  (signed upload URL server orqali), kurator/staff o'qiydi.
- [ ] `Recorder`: `MediaRecorder` (`audio/webm;codecs=opus`, Safari uchun `audio/mp4` fallback), 180 soniya limit,
  to'lqin (AnalyserNode), qayta tinglash, "Yuborish". Ruxsat rad etilsa — tushunarli xato holati.
- [ ] `audio-upload` → `{ submissionId, uploadUrl }`; `audio-complete` → `submissions.status='pending'`, kurator guruhiga bot xabari (T22 klaviaturasi bilan).
- [ ] `[Artboard: Speaking]`: topshiriq kartasi, "Matnni yashirish", yozish tugmasi, "Video-krujok yuborish" (T21 deep link),
  oxirgi baholangan topshiriq (ball + kurator izohi).
- [ ] Testlar: MediaRecorder mock bilan limitda avtomatik to'xtaydi; API ruxsatsiz → 401; boshqa o'quvchi papkasi rad.
- [ ] Commit: `feat(speaking): in-app audio submissions`.

---

### Task 21: Gapirish — video Telegram orqali `[capable]`

**Depends:** T20
**Files:** `src/lib/telegram/handlers/video.ts`, `src/app/api/media/tg/[submissionId]/route.ts`, testlar.

- [ ] Deep link `https://t.me/<bot>?start=task_<exerciseId>`: bot foydalanuvchini `telegram_id` bo'yicha taniydi,
  mashq uning faol kursida ekanini tekshiradi, "Endi video-krujok yuboring (60 soniyagacha)" deydi va
  "kutilayotgan topshiriq"ni `bot_sessions(telegram_id pk, exercise_id, expires_at)` jadvaliga 30 daqiqaga yozadi
  (migratsiya `0006_bot_sessions.sql`).
- [ ] `message:video_note` yoki `message:video` (≤ 20 MB): `copyMessage` → `TELEGRAM_ARCHIVE_CHAT_ID`;
  `submissions(kind='video', tg_file_id, tg_archive_message_id, status='pending')`; kurator guruhiga yuborish (T22).
  Kutilayotgan topshiriq bo'lmasa — "Avval ilovadagi topshiriqdan tugmani bosing".
- [ ] `GET /api/media/tg/[submissionId]`: sessiya + RLS orqali submission'ni o'qish huquqi → `getFile` → Telegram fayl URL'idan
  stream proksi (`Content-Type` saqlanadi, `Cache-Control: private, max-age=300`). Token hech qachon javobga chiqmaydi.
- [ ] Testlar: kutilmagan video rad; kutilgan video submission yaratadi; proksi begona foydalanuvchiga 404.
- [ ] Commit: `feat(speaking): video-note submissions via telegram`.

---

### Task 22: Baholash servisi (veb + Telegram) `[capable]`

**Depends:** T21
**Files:** `src/server/reviews.ts`, `src/app/api/reviews/route.ts`, `src/lib/telegram/handlers/review.ts`,
`src/lib/telegram/keyboards.ts` (kengaytirish), testlar.

- [ ] `submitReview({submissionId, reviewerId, scores, comment, channel})`:
  reviewer — shu guruh kuratori yoki kurs ustozi/admin. Kurator uchun **birinchi baho g'olib**:
  `update submissions set status='reviewed' where id=$1 and status='pending' returning` — 0 qator bo'lsa 409 "Allaqachon baholangan".
  Ustoz/admin istalgan vaqtda `is_override=true` bilan yangi review qo'sha oladi.
  `total = o'rtacha(4 mezon)` 2 xonagacha. XP: `award_xp(speakingXp(total), 'speaking_reviewed', submissionId)`
  (override'da XP qayta berilmaydi). O'quvchiga bot xabari: ball + izoh.
- [ ] Telegram kurator xabari: audio/video + matn `<ism> · <dars> · <topshiriq>`, inline klaviatura 4 qator × 5 tugma
  (qator boshida mezon nomi ham tugma emas — matnda) + `Saqlash`. `callback_data` aynan:
  `rv:<submissionId>:<c>:<v>` (`c` ∈ `cm|pr|gr|fl`, `v` 1..5) va `rv:<submissionId>:save`.
  Ball bosilganda `submissions.draft_scores` yangilanadi va klaviatura belgilangan qiymatlarni `●` bilan ko'rsatadi
  (bu matn belgisi, UI emoji emas). `save` — 4 mezon to'liq bo'lsa `submitReview(channel='telegram')`.
  Veb'da baholangan bo'lsa xabar "Baholandi: X.X (<kurator>)" ga tahrirlanadi.
- [ ] Testlar: ikki kurator bir vaqtda → bittasi 409; to'liq bo'lmagan `save` rad; override XP qo'shmaydi;
  begona guruh kuratori rad.
- [ ] Commit: `feat(review): rubric reviews from web and telegram`.

---

### Task 23: Kurator veb-navbati `[standard]`

**Depends:** T22
**Files:** `src/app/(staff)/curator/page.tsx`, `src/components/staff/{ReviewCard,RubricRow,MediaPlayer}.tsx`, testlar.

- [ ] `[Artboard: Curator]`: navbat soni, joriy topshiriq (o'quvchi, dars, vaqt), pleyer (audio — signed URL; video — T21 proksi),
  tezlik 1/1.25/1.5, "Matnni ko'rsatish", 4 mezon × 1–5 (tugmalar ≥ 40px, `aria-label="Talaffuz: 4"`), izoh,
  "O'tkazish" va "Baholash · X.X · keyingisi". Klaviatura: `1–5` joriy mezonga, `Tab` keyingi mezon, `Enter` yuborish.
- [ ] Navbat tartibi: eng eskisi birinchi. Bo'sh navbat — empty holat.
- [ ] Testlar: yuborishdan keyin keyingi topshiriq ochiladi; 409 bo'lsa "Boshqa kurator baholadi" va keyingisiga o'tadi.
- [ ] Commit: `feat(curator): review queue`.

---

### Task 24: Reyting va streak tabrigi `[standard]`

**Depends:** T15, T7
**Files:** `src/app/(student)/rating/page.tsx`, `src/components/student/{Podium,RankRow,StreakCelebration}.tsx`, testlar.

- [ ] `[Artboard: Leaderboard]`: tablar Gapirish/XP, davr Hafta/Oy, podium (2-1-3 tartib, 1-o'rin kattaroq,
  ustun rangi chegara chizig'ida, raqam `--ink`), ro'yxat 4+, "Siz" qatori sariq.
  Gapirish tabida banner: "Oy yakunida gapirish bo'yicha top-3 ustozdan sovg'a oladi. Natijalarni ustoz tasdiqlaydi."
  `eligible=false` lar "Kamida 8 ta topshiriq kerak" yorlig'i bilan pastda.
- [ ] `StreakCelebration` `[Artboard: Streak]` (ataylab to'q): 7/14/30 kunlik chegarada bir marta ko'rsatiladi
  (`localStorage` kaliti `streak-celebrated-<n>-<day>`, try/catch), `prefers-reduced-motion` hurmat qilinadi.
  Streak bonusi XP'si serverda (`award_xp(...,'streak_bonus','streak:<n>:<day>')`) — `getDashboard` chaqirilganda tekshiriladi.
- [ ] Testlar: podium tartibi; eligible bo'lmaganlar pastda; bonus bir marta.
- [ ] Commit: `feat(student): leaderboards and streak celebration`.

---

### Task 25: Ustoz qobig'i va bosh panel `[standard]`

**Depends:** T13, T23
**Files:** `src/app/(staff)/layout.tsx`, `src/app/(staff)/teacher/page.tsx`,
`src/components/staff/{Sidebar,KpiTile,ActivityChart,RequestsCard,LessonCompletion,CuratorTable,IdleStudents}.tsx`,
`supabase/migrations/0007_teacher_stats.sql` (statistika funksiyalari), testlar.

- [ ] `[Artboard: TeacherDashboard]`: suyuq (fluid) layout — `flex-wrap`, sidebar `flex: 1 1 240px` (`--ink` fon,
  faol element sariq), kontent `flex: 999 1 560px; min-width: 0`. Telefon kengligida sidebar tepaga o'tadi.
- [ ] Statistika funksiyalari (`security definer`, faqat kurs ustozi): `teacher_kpis(cohort)`,
  `daily_active(cohort, days=14)`, `lesson_completion(cohort)`, `curator_stats(cohort)` (o'quvchilar, navbat, o'rtacha baho,
  o'rtacha javob vaqti soatda), `idle_students(cohort, days=3)`.
- [ ] `ActivityChart`: bitta seriya, rang `#3D7BEA` (validator: PASS), hover/focus'da tooltip, ustunlar `button` + `aria-label`,
  y o'qi 0/50/100, jadval ko'rinishi (`<details>` ichida) — dataviz talablari.
- [ ] `RequestsCard`: pending enrollment'lar, "Ruxsat" (server action → `approveEnrollment`), "Rad etish".
- [ ] `CuratorTable`: navbat > 15 qizil chip. `IdleStudents`: "Eslatma" → bot orqali o'quvchiga eslatma xabari.
- [ ] Testlar: statistika funksiyalari (DB), begona ustoz bo'sh natija; komponentlar render.
- [ ] Commit: `feat(teacher): dashboard`.

---

### Task 26: Dars muharriri `[capable]`

**Depends:** T25
**Files:** `src/app/(staff)/teacher/lessons/[lessonId]/page.tsx`, `src/components/staff/editor/*`,
`src/server/content-admin.ts`, testlar.

- [ ] `[Artboard: TeacherLessonEditor]`: chapda modul/dars daraxti (+ Yangi dars), sarlavha/maqsad tahriri,
  "1-kun · Grammatika / 2-kun · Razgovor" tablari, bloklar ro'yxati (`@dnd-kit/sortable`, klaviatura bilan ham),
  "+ Blok qo'shish" (Video, Audio, Qoida rasmi, Mashq, So'zlar, Matn, Gapirish).
- [ ] Blok muharrirlari: video (YouTube havola validatsiyasi), audio/rasm (Storage `content` bucket'ga yuklash, 20 MB),
  matn (oddiy textarea + so'zlarni belgilash), mashqlar — 5 tur uchun forma (T8 `Payload`+`Key` sxemalari zod bilan),
  so'zlar (jadval + **CSV import**: ustunlar aynan `ru,stress,uz,pos,gender,example_ru,example_uz`, `papaparse`, xatolar qatorma-qator),
  gapirish (limit, XP 40, kanal: ovoz/video).
- [ ] Avto-saqlash (1.5 s debounce) → holat "Qoralama · N daqiqa oldin saqlandi"; "Nashr qilish" → `published=true`.
  "O'quvchi ko'rinishi" → `/lesson/<partId>?preview=1` (faqat staff uchun, qoralamalarni ham ko'rsatadi).
- [ ] Barcha yozishlar server action'lar orqali, `teaches_course` tekshiruvi bilan.
- [ ] Testlar: CSV import (to'g'ri fayl, yetishmayotgan ustun, bo'sh `uz`); tartibni almashtirish saqlanadi;
  mashq formasi noto'g'ri kalitni rad etadi; boshqa ustoz kursiga yozish rad.
- [ ] Commit: `feat(teacher): lesson editor`.

---

### Task 27: O'quvchilar, kohortalar, kuratorlar boshqaruvi `[standard]`

**Depends:** T26
**Files:** `src/app/(staff)/teacher/students/page.tsx`, `src/app/(staff)/teacher/cohorts/page.tsx`, testlar.

- [ ] O'quvchilar jadvali: qidiruv, filtr (holat, guruh), ustunlar (ism, telefon maskalangan, guruh, progress, streak, oxirgi faollik),
  amallar: ruxsat/rad, guruhni almashtirish, muddatni uzaytirish. Telefon kengligida jadval `overflow-x: auto`.
- [ ] Kohortalar: yaratish (nom, sanalar, kirish muddati), kurator guruhlari (kurator profilini `telegram_id` yoki telefon bo'yicha tayinlash,
  guruh Telegram chat ID'si).
- [ ] Testlar: guruh almashtirish RLS ostida; begona kohorta ko'rinmaydi.
- [ ] Commit: `feat(teacher): students, cohorts and curator groups`.

---

### Task 28: Modul testi `[standard]`

**Depends:** T26
**Files:** `src/app/(staff)/teacher/tests/page.tsx`, `src/app/(student)/test/[testId]/page.tsx`, `src/server/tests.ts`, testlar.

- [ ] Ustoz: test yaratish (modulga bog'langan), mavjud mashqlardan yoki yangi mashqlardan bo'limlarga element qo'shish,
  vaqt limiti, o'tish bali.
- [ ] O'quvchi: test faqat `computePathStatus` bo'yicha `available` bo'lganda; taymer; javoblar oxirida serverda tekshiriladi
  (bir martalik `test_attempts`); natija ekrani: umumiy ball, to'g'ri/xato soni, bo'limlar bo'yicha foiz,
  50% dan past bo'limlar uchun "Qayta ko'ring: <darslar>" tavsiyasi; `testXp`.
  Ochiq javobli bo'limlar kurator baholagach yakuniy ballga qo'shiladi.
- [ ] Testlar: vaqt tugashida avtomatik yuborish; ikkinchi urinish rad; tavsiyalar to'g'ri darslarga ishora qiladi.
- [ ] Commit: `feat(tests): module assessment`.

---

### Task 29: 1-modul kontenti va import `[capable]`

**Depends:** T26
**Files:** `content/module-1/lesson-01.json` … `lesson-10.json`, `content/schema.ts`, `scripts/content-import.ts`, testlar.

- [ ] `content/schema.ts` (zod): dars → 2 qism → bloklar → mashqlar (`payload` + `key`) + so'zlar. Import idempotent (`slug` bo'yicha upsert).
- [ ] **Faqat haqiqiy material:** kitobdan mavjud sahifalar asosida 1- va 2-darslar to'liq
  (rod jadvali, -ь so'zlari, Упражнение 1–3, «Солистка оперы», «Командировка» va savollar, uy vazifasi bloklari).
  3–10-darslar: sarlavha va maqsad (mundarijadan), bloklarsiz, `published: false`.
- [ ] O'zbekcha tarjimalar men tayyorlagan qoralama bo'lsa `"needs_review": true` belgisi bilan; muharrirda sariq belgi ko'rinadi.
- [ ] Kitob PDF'lari repoga qo'shilmaydi; JSON faqat mashq uchun zarur matnni o'z ichiga oladi.
- [ ] Testlar: barcha JSON sxemadan o'tadi; import ikki marta → dublikat yo'q.
- [ ] Commit: `feat(content): module 1 structure and lessons 1-2`.

---

### Task 30: PWA `[cheap]`

**Depends:** T15
**Files:** `src/app/manifest.ts`, `public/icons/*`, `src/app/sw.ts` (Serwist), `src/app/offline/page.tsx`.

- [ ] Manifest: `name: "Po-russki gaplashamiz"`, `short_name: "Po-russki"`, `theme_color: "#FAF7EC"`,
  `background_color: "#FAF7EC"`, `display: "standalone"`, `lang: "uz"`, 192/512 + maskable ikonkalar (sariq fon, "Ж").
- [ ] Service worker: statik resurslar keshi, offline sahifa; API javoblari keshlanmaydi.
- [ ] Commit: `feat(pwa): installable app with offline fallback`.

---

### Task 31: CI, zaxira va deploy skriptlari `[standard]`

**Depends:** T29
**Files:** `.github/workflows/{ci,keepalive,backup}.yml`, `scripts/set-webhook.ts`, `README.md`.

- [ ] `ci.yml`: push/PR → pnpm install → lint → typecheck → unit → `test:db` (Postgres 16 service container) → build.
- [ ] `keepalive.yml`: har kuni (`cron: '17 4 * * *'`) Supabase REST'ga yengil `select` (secret'lar GitHub Secrets'da).
- [ ] `backup.yml`: haftalik `pg_dump` → private artefakt (90 kun saqlanadi). `SUPABASE_DB_URL` secret.
- [ ] `set-webhook.ts`: `setWebhook(APP_URL + '/api/telegram/webhook', { secret_token, allowed_updates: ['message','callback_query'] })`.
- [ ] README: lokal ishga tushirish, env, Supabase loyiha yaratish, migratsiyalarni qo'llash, bot yaratish (BotFather),
  ombor kanal/kurator guruhlarini sozlash, deploy.
- [ ] Commit: `chore(ci): pipelines, keepalive, backups and setup docs`.

---

### Task 32: E2E testlar `[standard]`

**Depends:** T31
**Files:** `tests/e2e/*.spec.ts`, `src/app/api/test/login/route.ts`.

- [ ] Test-login: faqat `NODE_ENV === 'test'` va `E2E_SECRET` sarlavhasi to'g'ri bo'lsa ishlaydi; productionda route 404
  (build vaqtida ham tekshiriladigan test bilan).
- [ ] Ssenariylar: o'quvchi → home → path → 1-dars → classify mashqi (to'g'ri) → XP oshdi → qism tugadi;
  kurator → navbat → baholash → o'quvchi bahoni ko'radi; ustoz → pending o'quvchiga ruxsat → o'quvchi kursni ko'radi.
  Mobil viewport (`iPhone 14`) va desktop.
- [ ] Commit: `test(e2e): core student, curator and teacher flows`.

---

## 3. Bajarish tartibi va nazorat nuqtalari

| Bosqich | Vazifalar | Nazorat (foydalanuvchi ko'radi) |
|---|---|---|
| A. Poydevor | T1–T3 | `/dev/ui` sahifasi, testlar yashil |
| B. Ma'lumotlar | T4–T7 | RLS testlari yashil |
| C. Mantiq | T8–T9 | unit testlar |
| D. Kirish | T10–T13 | Telegram orqali haqiqiy kirish (Supabase + bot sozlangach) |
| E. O'quvchi | T14–T21, T24 | 1-dars boshidan oxirigacha |
| F. Baholash | T22–T23 | kurator Telegram va veb'da baholaydi |
| G. Ustoz | T25–T28 | panel, muharrir, test |
| H. Kontent va chiqarish | T29–T32 | sinov guruhiga tayyor |

## 4. Bajarishdan oldin kerak bo'ladigan narsalar (foydalanuvchidan)

1. **GitHub push huquqi** — Claude GitHub App'ni repoga o'rnatish (hozir push 403).
2. **Supabase loyihasi** (Free) — URL, anon key, service role key (D bosqichigacha).
3. **Telegram bot** (BotFather) — token; ombor kanal, ustoz guruhi, kurator guruhlari (D/F bosqichigacha).
4. Lug'at kitobi va qolgan darslar materiali (H bosqichigacha) — bo'lmasa 3–10-darslar bo'sh qoladi.

A–C bosqichlari tashqi hisob talab qilmaydi va darhol boshlanishi mumkin.
