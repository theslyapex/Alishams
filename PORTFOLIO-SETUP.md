# راه‌اندازی سیستم پیشرفته نمونه‌کارهای Alishams Studio

## فایل‌های سایت
- `logo-portfolio.html`: گالری لوگوها
- `ad-image-portfolio.html`: گالری تصاویر تبلیغاتی
- `portfolio-admin.html`: پنل مدیریت خصوصی
- `portfolio-system.js`: بارگذاری گالری و ثبت بازدیدها
- `portfolio-backend-setup.sql`: ساخت جدول‌ها، سیاست‌های دسترسی و فضای ذخیره‌سازی در Supabase

## راه‌اندازی الزامی (یک‌بار)
1. وارد داشبورد پروژه Supabase متصل به سایت شوید.
2. در بخش SQL Editor، محتوای فایل `portfolio-backend-setup.sql` را اجرا کنید.
3. در Authentication، حساب مدیر را بسازید (یا از حساب موجود استفاده کنید).
4. شناسه UUID همان کاربر را از فهرست Users بردارید.
5. در SQL Editor اجرا کنید و UUID واقعی را جایگزین کنید:
   `insert into public.portfolio_admins(user_id) values ('UUID-USER-HERE');`
6. در Authentication > Providers بررسی کنید Email/Password فعال باشد.
7. پس از انتشار GitHub Pages، وارد `/portfolio-admin.html` شوید و یک تصویر آزمایشی منتشر کنید.

## آمار
بازدید صفحه با بارگذاری صفحه ثبت می‌شود؛ بازدید یک اثر زمانی ثبت می‌شود که بازدیدکننده روی کارت آن اثر بزند و تصویر بزرگ را باز کند. هر بازشدن مجدد نیز بازدید جدید حساب می‌شود. این آمار خام است و ممکن است شامل بازدیدهای تکراری یا ربات‌ها باشد.

## امنیت
کلید قابل‌نمایش مرورگر فقط publishable/anon key است؛ هرگز service_role key را در HTML یا JavaScript قرار ندهید. دسترسی نوشتن و آپلود با Row Level Security و جدول `portfolio_admins` محدود شده است. فقط UUID مدیران مورد اعتماد را در آن جدول قرار دهید.
