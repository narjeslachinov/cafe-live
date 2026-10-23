# سفارش‌یار

سفارش زنده سر میز و نمایش آن در آشپزخانه برای کافه‌رستوران‌ها.
محدودهٔ پروژه در [SCOPE.md](./SCOPE.md) و تصمیم‌های فنی در [DECISIONS.md](./DECISIONS.md) آمده‌اند.

> وضعیت: در حال ساخت. فاز ۰ و ۱ (اسکلت و دیتابیس) انجام شده است. احراز هویت، سفارش و آشپزخانه هنوز ساخته نشده‌اند.

## پیش‌نیازها

- Node.js 20.6 یا بالاتر
- PostgreSQL 16، به یکی از دو روش:
  - **Docker** (با `npm run db:up`)
  - **نصب مستقیم:** PostgreSQL را نصب کنید و دیتابیس بسازید:
    `CREATE DATABASE sarfaresh;`

## راه‌اندازی محلی

```bash
cp .env.example .env.local      # در ویندوز: copy .env.example .env.local
npm install
npm run db:up                   # فقط اگر از Docker استفاده می‌کنید
npm run db:migrate              # ساخت نقش برنامه، جدول‌ها و سیاست‌های RLS
npm run dev                     # http://localhost:3000
```

در `.env.local` مقدار `SESSION_SECRET` را با یک رشتهٔ تصادفی حداقل ۳۲ نویسه‌ای عوض کنید و اگر PostgreSQL را مستقیم نصب کرده‌اید، رمز واقعی کاربر `postgres` را در `DATABASE_URL_ADMIN` بگذارید.

بررسی سلامت: `http://localhost:3000/api/health` باید `{"status":"ok"}` برگرداند.

## معماری (تا اینجا)

- **Next.js (App Router) + TypeScript**: رابط راست‌به‌چپ و API در یک پروژه.
- **PostgreSQL 16**: همهٔ دادهٔ هر رستوران با `restaurant_id` علامت‌گذاری شده است.
- **جداسازی رستوران‌ها در دو لایه:**
  1. Row Level Security: برنامه با نقش محدود `sarfaresh_app` وصل می‌شود که Superuser نیست و RLS را دور نمی‌زند.
  2. کلید خارجی ترکیبی `(id, restaurant_id)`: هیچ رکوردی نمی‌تواند به رکورد رستوران دیگر اشاره کند.
- **`withTenant`** (در `src/server/db.ts`): همهٔ پرس‌وجوها درون تراکنشی اجرا می‌شوند که رستوران فعلی را با `set_config` تنظیم می‌کند. اگر تنظیم نشود، هیچ ردیفی دیده نمی‌شود.
- **آیتم‌های سفارش ردیف جدا هستند**، نه JSON داخل سفارش، تا افزودن هم‌زمان باعث گم شدن تغییر نشود.
- **اعتبارسنجی env** هنگام شروع با Zod. تنظیمات ناقص باعث توقف برنامه می‌شود.
- **لاگ ساخت‌یافته** با Pino و حذف فیلدهای حساس.
- **احراز هویت:** کوکی HttpOnly امضاشده؛ نقش و فعال بودن عضویت در هر درخواست از دیتابیس خوانده می‌شود. ساخت کاربر: `npm run user:create -- --help` (ببینید پارامترها در `scripts/create-user.mjs`).
- **تست دودی ورود:** `npm run smoke:auth` (سرور باید در حال اجرا باشد).

## ساختار پوشه‌ها

```
src/app/        صفحه‌ها و API
src/lib/        ابزارهای مشترک (env, logger)
src/server/     کد فقط سمت سرور (دیتابیس، ...)
db/migrations/  فایل‌های SQL شماره‌دار
scripts/        اسکریپت اجرای Migration
```

## متغیرهای محیطی

| نام | کاربرد |
|---|---|
| `DATABASE_URL` | اتصال برنامه (نقش محدود) |
| `DATABASE_URL_ADMIN` | فقط برای Migration و Seed، هرگز در برنامهٔ در حال اجرا استفاده نمی‌شود |
| `APP_DB_PASSWORD` | رمز نقش برنامه هنگام ساخت آن |
| `SESSION_SECRET` | کلید امضای نشست (حداقل ۳۲ نویسه) |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error` |

## بررسی دستی جداسازی رستوران‌ها

در `psql` با کاربر مدیر، دو رستوران بسازید، سپس با نقش برنامه:

```sql
SET ROLE sarfaresh_app;
SELECT count(*) FROM restaurants;                    -- 0: بدون رستوران تنظیم‌شده چیزی دیده نمی‌شود
BEGIN;
SELECT set_config('app.restaurant_id', '<id-a>', true);
SELECT slug FROM restaurants;                        -- فقط a
INSERT INTO dining_tables (restaurant_id, label) VALUES ('<id-b>', '1');  -- خطای RLS
ROLLBACK;
```

این بررسی در فاز ۷ به تست خودکار تبدیل می‌شود.

## آزمون‌ها

(در فاز ۷ اضافه می‌شود.)