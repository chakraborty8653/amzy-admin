alter table public.telegram_login_codes
  add column if not exists phone_number text;
