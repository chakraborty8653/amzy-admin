create table if not exists public.telegram_runtime_config (
  id boolean primary key default true check (id),
  api_id integer not null check (api_id > 0),
  api_hash text not null check (api_hash ~ '^[A-Fa-f0-9]{32}$'),
  updated_at timestamptz not null default now()
);

alter table public.telegram_runtime_config enable row level security;
revoke all on public.telegram_runtime_config from anon, authenticated;
grant all on public.telegram_runtime_config to service_role;
