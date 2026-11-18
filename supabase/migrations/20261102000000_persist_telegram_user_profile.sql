alter table public.users
  add column if not exists telegram_id text,
  add column if not exists username text,
  add column if not exists phone_number text;

alter table public.telegram_login_codes
  add column if not exists username text,
  add column if not exists phone_number text;

alter table public.channels
  add column if not exists telegram_chat_id text,
  add column if not exists telegram_chat_kind text,
  add column if not exists is_public_telegram_chat boolean;

create index if not exists users_telegram_id_idx
  on public.users (telegram_id);
