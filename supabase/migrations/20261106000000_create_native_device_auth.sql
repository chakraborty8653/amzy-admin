create table if not exists public.native_login_challenges (
  challenge_hash text primary key,
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create table if not exists public.device_keys (
  uid text primary key,
  public_key text not null,
  created_at timestamptz not null default now()
);

alter table public.native_login_challenges enable row level security;
alter table public.device_keys enable row level security;

revoke all on table public.native_login_challenges, public.device_keys from anon, authenticated;
grant all on table public.native_login_challenges, public.device_keys to service_role;
