# Po russki

Rus tilini o'rganish platformasi (Next.js 15, Supabase, Telegram).

```
pnpm install
pnpm dev
pnpm lint && pnpm typecheck && pnpm test
```

Muhit o'zgaruvchilari: `.env.example`.

## Supabase sozlamalari (checklist)

- [ ] Supabase Auth'da **public email signup o'chirilgan** (Authentication, Providers, Email, "Allow new users to sign up" off). Foydalanuvchilar faqat bot orqali yaratiladi; aks holda hujumchi `tg_<id>@users.internal` emailini oldindan ro'yxatdan o'tkazishi mumkin.
