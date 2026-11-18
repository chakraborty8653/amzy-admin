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

  delete from public.device_keys where uid = p_uid;
  delete from public.native_login_challenges where verified_uid = p_uid;
  delete from public.users where uid = p_uid;
end;
$$;

revoke all on function public.delete_amzy_cloud_account(text) from public, anon, authenticated;
grant execute on function public.delete_amzy_cloud_account(text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('amzy-legal', 'amzy-legal', true, 262144, array['text/html'])
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
