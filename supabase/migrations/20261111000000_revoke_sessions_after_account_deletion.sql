create table if not exists public.deleted_accounts (
  uid text primary key,
  deleted_at timestamptz not null default now(),
  purge_after timestamptz not null default (now() + interval '8 days')
);

alter table public.deleted_accounts enable row level security;
revoke all on table public.deleted_accounts from anon, authenticated;
grant all on table public.deleted_accounts to service_role;

alter table public.native_login_challenges
  add column if not exists purpose text not null default 'login';

alter table public.native_login_challenges
  drop constraint if exists native_login_challenges_purpose_check;
alter table public.native_login_challenges
  add constraint native_login_challenges_purpose_check check (purpose in ('login', 'delete'));

create or replace function public.delete_amzy_cloud_account(p_uid text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_uid is null or p_uid !~ '^telegram:[0-9]+$' then
    raise exception 'Invalid AMZY account identifier';
  end if;

  insert into public.deleted_accounts (uid, deleted_at, purge_after)
  values (p_uid, now(), now() + interval '8 days')
  on conflict (uid) do update
    set deleted_at = excluded.deleted_at,
        purge_after = excluded.purge_after;

  delete from public.device_keys where uid = p_uid;
  delete from public.native_login_challenges where verified_uid = p_uid;
  delete from public.users where uid = p_uid;
end;
$$;

revoke all on function public.delete_amzy_cloud_account(text) from public, anon, authenticated;
grant execute on function public.delete_amzy_cloud_account(text) to service_role;

create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'amzy-purge-deleted-accounts',
  '17 * * * *',
  $cron$delete from public.deleted_accounts where purge_after <= now()$cron$
)
where not exists (
  select 1 from cron.job where jobname = 'amzy-purge-deleted-accounts'
);
