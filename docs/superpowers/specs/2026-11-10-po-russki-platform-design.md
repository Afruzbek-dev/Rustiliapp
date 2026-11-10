# «По-русски говорим» — o'quv platformasi: texnik spetsifikatsiya

- **Sana:** 2026-11-10
- **Holat:** ko'rib chiqish uchun qoralama
- **Dizayn maketi:** «Sariq daftar» kanvasi (Claude Artifact, private)
- **Asos:** Master Prompt + «Po-russki gaplashamiz» kitobi (Z. Kasimova, 2024) tahlili

---

## 1. Maqsad va doira

Ustozning mavjud 2 oylik rus tili kursini mobil-birinchi PWA ko'rinishidagi raqamli
o'quv muhitiga aylantirish: dars yo'li, mashqlar, so'z yodlash, gapirish amaliyoti,
gamifikatsiya, kurator tomonidan baholash va ustoz paneli.

**v0.1 (MVP) maqsadi:** 1-modul (10 dars) + Test 1 to'liq raqamlashtirilgan holda
20–30 real o'quvchida sinovdan o'tkazish.

**Doiradan tashqari (hozircha):** native ilovalar, to'lov integratsiyasi
(Payme/Click), avtomatik talaffuz bahosi, ko'p tilli interfeys, chat/forum,
Telegram Mini App.

## 2. Kurs tuzilishi (kitobdan)

- 2 modul, 24 dars. 1-modul: 1–10-darslar, 2-modul: 11–24-darslar.
- Har dars **2 qism**, har qism **1 kun**:
  - **1-kun · Grammatika:** qo'lda chizilgan qoida sxemasi, Аудиоурок, istisnolar, Упражнения.
  - **2-kun · Razgovor (Разговорная часть):** yangi so'zlar, matn (hikoya), matn bo'yicha savollar.
- **Домашнее задание:** audio darsni tinglash, mashqlar, matnni yod olib video yuborish,
  "50 ta fe'l", tarjima, karaoke.
- Test: har modul oxirida (Test 1 — 10-darsdan keyin).

## 3. Rollar

| Rol | Huquqlar |
|---|---|
| `student` | Faol `enrollment`'i bor kurs kontenti, o'z progressi, topshiriqlari |
| `curator` | Faqat o'ziga biriktirilgan `curator_group` o'quvchilari va ularning topshiriqlari; baholash |
| `teacher` | O'z kurslari: kontent, potoklar, kuratorlar, ruxsatlar, statistika, istalgan bahoni o'zgartirish |
| `admin` | Butun platforma |

## 4. Arxitektura (tasdiqlangan: A variant)

```
[PWA: Next.js (App Router) + Tailwind + Lucide]
      │  Supabase JS (RLS bilan)          │ Route handlers (server)
      ▼                                   ▼
[Supabase: Postgres + Auth + Storage]   /api/telegram/webhook  (bot, grammY)
                                        /api/auth/telegram     (sessiya yaratish)
                                        /api/media/tg/[id]     (video proksi)
      ▲
[Telegram Bot API] ── yopiq "ombor" kanal, kurator guruhlari, ustoz guruhi
```

- Bitta repo, bitta deploy (Vercel). Bot — webhook rejimida, Next.js route handler ichida.
- Server-only sirlar: `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`.
- **Tariflar:** sinov davrida Supabase Free + Vercel Hobby. Haqiqiy (pullik) potokdan
  oldin: Supabase Pro ($25/oy, backup + pauza yo'q) va hosting — Vercel Pro ($20)
  yoki tijoratga ruxsat beruvchi bepul hosting (Cloudflare/Netlify).
- **Bepul tarif himoyasi:** GitHub Actions — kunlik "ping" (pauzaga qarshi) va haftalik
  `pg_dump` zaxira (private artefakt).

## 5. Kirish va kursga ruxsat

1. Saytda "Telegram orqali kirish" → `t.me/<bot>?start=login_<nonce>` (nonce bazada, 10 daqiqa).
2. Bot `request_contact` tugmasini ko'rsatadi. Qabul qilinganda `contact.user_id === from.id`
   tekshiriladi (birovning kontakti rad etiladi).
3. Server `profiles` ni yaratadi/yangilaydi (telefon, `telegram_id`), nonce'ni "tasdiqlangan" deb belgilaydi.
4. Brauzer nonce holatini har 2 soniyada so'raydi → nonce tasdiqlangach `/api/auth/telegram`
   service role bilan `auth.admin.generateLink({ type: 'magiclink', email: 'tg_<telegram_id>@users.internal' })`
   chaqiradi va `token_hash` qaytaradi; klient `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })`
   bilan sessiya oladi. Email faqat ichki identifikator, hech qayerga xat yuborilmaydi. Nonce bir martalik.
5. `enrollment` yo'q yoki `pending` → "Ustoz tasdig'i kutilmoqda" ekrani.
   Bot ustoz guruhiga `[Ruxsat → Potok N] [Rad etish]` tugmalari bilan xabar yuboradi;
   xuddi shu amal veb-panelda ham bor.
6. Ruxsat berilganda: `enrollment.status = active`, kurator guruhiga biriktirish
   (ustoz tanlaydi yoki eng kam o'quvchili guruhga avtomatik), botdan "Kurs ochildi" xabari.
7. Kelajakda: Payme/Click webhook'i `enrollment.source = payme|click` bilan o'zi faollashtiradi.

`enrollment.expires_at` (kurs tugashi + 1 oy) o'tganda kontent yopiladi, progress saqlanadi.

## 6. Ma'lumotlar modeli

**Foydalanuvchi va kirish**
- `profiles(id → auth.users, full_name, phone, telegram_id unique, telegram_username, role, created_at)`
- `courses(id, teacher_id, title, slug, description)`
- `cohorts(id, course_id, name, starts_on, ends_on, access_until)`
- `curator_groups(id, cohort_id, curator_id, name, telegram_chat_id)`
- `enrollments(id, student_id, cohort_id, curator_group_id, status[pending|active|rejected|expired], source[manual|payme|click], approved_by, approved_at, expires_at)`
- `login_nonces(nonce, telegram_id, status, expires_at)`

**Kontent**
- `modules(id, course_id, position, title)`
- `lessons(id, module_id, position, title, objective)`
- `lesson_parts(id, lesson_id, position[1|2], kind[grammar|conversation], title)`
- `blocks(id, lesson_part_id, position, type[video|audio|rule_image|text|reading|exercise|speaking|words], payload jsonb, published bool)`
- `exercises(id, block_id, type, prompt, payload jsonb, answer jsonb, check_mode[auto|review], xp)`
- `words(id, course_id, ru, stress, uz, pos, gender, example_ru, example_uz, audio_path)` + `lesson_words(lesson_id, word_id)`
- `texts(id, course_id, title, body, audio_path, source[lesson|library])`
- `tests(id, course_id, after_module_id, title, time_limit_min, pass_score)` + `test_items(test_id, exercise_id, section[vocab|grammar|reading|listening|writing], position)`

**Progress va topshiriqlar**
- `part_progress(student_id, lesson_part_id, status[in_progress|completed], started_at, completed_at)` — "locked/available" hisoblanadi, saqlanmaydi.
- `attempts(id, student_id, exercise_id, answer jsonb, is_correct, created_at)`
- `submissions(id, student_id, exercise_id, curator_group_id, kind[audio|video|text], storage_path, tg_file_id, tg_archive_message_id, text_answer, status[pending|reviewed], created_at)`
- `reviews(id, submission_id, reviewer_id, channel[web|telegram], scores jsonb, total numeric, comment, is_override, created_at)` — tarix saqlanadi, oxirgisi amalda.
- `srs_cards(student_id, word_id, interval_days, ease, due_at, reps, lapses, is_difficult)`
- `test_attempts(id, student_id, test_id, score, section_scores jsonb, started_at, finished_at)`

**Gamifikatsiya**
- `xp_events(id, student_id, amount, reason, ref_id, created_at, unique(student_id, reason, ref_id))`
- `daily_activity(student_id, day date /* Asia/Tashkent */, xp, tasks jsonb)`
- `achievements(code, title, description, icon)` + `student_achievements(student_id, code, earned_at)`
- View'lar: `leaderboard_xp_week`, `leaderboard_xp_month`, `leaderboard_speaking_month`.

## 7. Mashq dvigateli

Bitta `exercises` jadvali, `type` + `payload` (JSON). Har tur uchun bitta React komponent.

| `type` | Kitobdagi misol | Tekshiruv |
|---|---|---|
| `classify` | So'zlarning rodini aniqlash (м.р/ж.р/ср.р) | auto |
| `fill_blank` | Qavsdagi fe'lni to'g'ri shaklga qo'yish; ko'plik yasash | auto (bir nechta to'g'ri variant) |
| `conjugate` | Fe'lni я/ты/он…/они bo'yicha tuslash | auto |
| `choose` | Мочь или уметь? | auto |
| `match` | Ruscha ↔ o'zbekcha juftlash | auto |
| `arrange` | So'zlardan gap tuzish | auto |
| `listen_pick` | Eshitib so'zni topish | auto |
| `open_text` | Matn bo'yicha savolga javob; shaxsiy matn | review |
| `speaking` | Matnni yod aytish (audio/video) | review |

- **Tekshiruv serverda:** `submit_attempt(exercise_id, answer)` RPC (security definer).
  To'g'ri javoblar (`answer`) klientga hech qachon yuborilmaydi. Normalizatsiya:
  bo'shliqlar, katta-kichik harf, `ё→е` ixtiyoriy.
- XP faqat server tomonidan `xp_events` ga yoziladi.

## 8. Media

- **Ovoz:** brauzerda yoziladi (MediaRecorder, Opus/WebM, mono), limit 3 daqiqa,
  Supabase Storage `submissions/` bucket (private, RLS). Taxminan 0.5 MB/daqiqa.
- **Video:** faqat Telegram bot orqali (video-krujok, 60 s):
  ilova → `t.me/<bot>?start=task_<exercise_id>` → o'quvchi krujok yuboradi →
  bot `copyMessage` bilan yopiq ombor kanalga nusxalaydi → `submissions` yozuvi →
  kurator guruhiga ball tugmalari bilan yuboradi.
- Video ilovada `/api/media/tg/[submission_id]` proksi orqali ochiladi (`getFile`, ≤20 MB;
  token serverda qoladi; ruxsat RLS bilan tekshiriladi).
- **Darslik videolari:** YouTube (unlisted) yoki Bunny Stream; Supabase'da saqlanmaydi.
- **Audio darslar va qoida rasmlari:** Supabase Storage `content/` bucket (faqat faol o'quvchilarga signed URL).

## 9. Baholash

- **Rubrika** (har biri 1–5): matnni to'liq aytdi · talaffuz · grammatika · ravonlik. `total` = o'rtacha.
- **Ikki kanal:** veb-panel yoki Telegram guruhidagi tugmalar. Birinchi yozilgan baho amalda;
  ikkinchi kanaldagi xabar "Baholandi: X (kurator Y)" ga yangilanadi.
- **Ustoz ustunligi:** istalgan bahoni o'zgartiradi (`is_override = true`), tarix saqlanadi.
- **Adolat:** kuratorlar statistikasi (o'rtacha baho, navbat, javob vaqti);
  oy oxirida gapirish reytingi top-10 ustoz tasdiqiga chiqadi.
- O'quvchi bahoni va izohni ilovada ko'radi + bot xabari.

## 10. Gamifikatsiya

| Hodisa | XP |
|---|---|
| Avto mashq — to'g'ri javob | 10 (birinchi urinish) / 5 (keyingi) |
| Dars qismi tugashi | 20 |
| Gapirish topshirig'i baholandi | 40 × (total / 5) |
| Kunlik vazifalar to'liq | 30 |
| Streak bonusi (7, 14, 30 kun) | 50 / 100 / 200 |
| Test | ball % × 2 |

- **Streak:** kun = Asia/Tashkent. Kamida bitta XP hodisasi bo'lsa kun hisoblanadi.
- **Kunlik vazifalar:** 10 yangi so'z · 1 grammatika mashqi · 1 audio · 1 gapirish.
- **Reyting:** haftalik/oylik XP; oylik gapirish (oy davomida baholangan topshiriqlar o'rtachasi; reytingga kirish uchun kamida 8 ta topshiriq, teng bo'lsa — ko'proq topshiriq yuborgan yuqorida).
- **Yutuqlar:** birinchi dars, 100 so'z, 7 kunlik streak, grammatika ustasi, tinglash chempioni, gapirish chempioni.

## 11. So'z takrorlash (SRS)

Soddalashtirilgan SM-2. Tugmalar: **Qayta** (10 daqiqa), **Qiyin** (1 kun),
**Bildim** (interval × ease; boshlang'ich 1 → 4 kun). "Qiyin so'z" belgisi alohida ro'yxat.

## 12. Testlar

- `test_items` mashq dvigatelidan qayta foydalanadi; bo'limlar bo'yicha ball.
- Natija: umumiy ball, to'g'ri/xato, bo'limlar, qayta ko'rish uchun tavsiya etiladigan darslar.
- Ochiq javobli bo'limlar (yozish) kurator baholagach yakunlanadi.

## 13. Ustoz va admin paneli (web, moslashuvchan)

- **Bosh panel:** faol o'quvchilar, bugun kirganlar, tekshirish navbati, o'rtacha progress,
  14 kunlik faollik grafigi, kirish so'rovlari (ruxsat/rad), dars tugatish foizlari,
  kuratorlar jadvali, "E'tibor kerak" (3+ kun kirmaganlar).
- **Dars muharriri:** modul/dars daraxti, 1-kun/2-kun tablari, bloklar ro'yxati (sudrab tartiblash),
  blok tahrirlagichlari, Excel/CSV'dan so'z yuklash, "O'quvchi ko'rinishi", qoralama → nashr.
- **O'quvchilar, kuratorlar, potoklar, testlar, reyting** sahifalari.

## 14. Dizayn tizimi «Sariq daftar»

- **Asosiy rejim — light.** Fon `#FAF7EC`, karta `#FFFFFF`, chegara `#E6E0CC`, matn `#1A1A17`,
  ikkinchi matn `#5F5B50`.
- **Brend:** sariq `#FFD60A` (fon/urg'u; matn sifatida emas — matn uchun `#8A6A00`),
  olov/xato `#FF6B4A`, to'g'ri `#3DDC84` (matn `#157A43`), ko'k `#3D7BEA`.
- **Shrift:** `-apple-system, BlinkMacSystemFont, Inter, sans-serif` (iOS/Mac'da SF Pro,
  boshqalarda Inter). Caveat — faqat kichik qo'lyozma urg'ular.
- **Katak fon** — faqat xush kelibsiz va o'quv yo'li ekranlarida, juda och (32px).
- Taktil tugmalar (pastki qalin soya), radius 12–24, ikonkalar Lucide, emoji yo'q,
  tegish maydoni ≥ 44px, matn kontrasti ≥ 4.5:1.
- Dark rejim tokenlar orqali (keyingi bosqich); streak tabrigi ataylab to'q.

## 15. Xavfsizlik

- Barcha jadvallarda RLS; yozish amallari RPC/route handler orqali.
- Bot webhook'i `X-Telegram-Bot-Api-Secret-Token` bilan tekshiriladi.
- Kontent faqat faol enrollment bilan; signed URL'lar qisqa muddatli.
- **Mualliflik huquqi:** kitob PDF'lari va media repoga commit qilinmaydi; repo private bo'lishi kerak.
  Uchinchi tomon materiallari (qo'shiqlar, liveworksheets rasmlari) ilovaga ko'chirilmaydi — Telegram kanalga havola.

## 16. MVP v0.1 doirasi

1. Telegram orqali kirish + ruxsat oqimi
2. O'quvchi: bosh sahifa, o'quv yo'li, dars pleyeri (bloklar), mashq turlari: `classify`, `fill_blank`, `conjugate`, `choose`, `match`
3. So'zlar: flashcard + SRS
4. Gapirish: ovoz (ilova) + video (bot), kurator baholashi (veb + Telegram)
5. XP, streak, kunlik vazifalar, reyting (XP + gapirish)
6. Ustoz paneli: bosh panel, ruxsatlar, dars muharriri, o'quvchilar
7. 1-modul kontenti (10 dars) + Test 1

**Keyingi bosqichlar:** `arrange`, `listen_pick`, o'qish kutubxonasi, karaoke,
2-modul, yutuqlar, dark rejim, to'lov, Mini App, AI yordamchi.

## 17. Test strategiyasi

- **Unit:** javob tekshiruvchilari (har `type`), XP/streak hisoblash, SRS intervallari.
- **DB:** RLS siyosatlari uchun SQL testlar (student/curator/teacher ko'radigan qatorlar).
- **Integratsiya:** bot webhook'i (Telegram update fixture'lari bilan), login oqimi.
- **E2E (Playwright):** kirish → dars → mashq → XP; kurator baholashi.

## 18. Ochiq savollar

1. Lug'at kitobi (so'zlar + o'zbekcha tarjima) — fayli hali olinmagan; tarjimalarni men qoralama qilaman, ustoz tasdiqlaydi.
2. Video darslar hozir qayerda va nechta (YouTube/Telegram)?
3. Kuratorlar soni va o'quvchilarni guruhlarga taqsimlash: qo'lda yoki avtomatik?
4. Repo private ekanligini tasdiqlash.
