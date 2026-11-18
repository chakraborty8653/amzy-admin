create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  message text not null check (char_length(message) between 1 and 2000),
  is_published boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists announcements_published_created_idx
  on public.announcements (created_at desc)
  where is_published = true;

alter table public.announcements enable row level security;
revoke all on table public.announcements from anon, authenticated;
grant all on table public.announcements to service_role;
