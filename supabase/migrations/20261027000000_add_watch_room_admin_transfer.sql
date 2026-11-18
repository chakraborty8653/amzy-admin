create or replace function public.transfer_watch_room_admin(
  p_code text,
  p_current_admin_id uuid,
  p_new_admin_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.watch_rooms%rowtype;
begin
  select * into room_row
  from public.watch_rooms
  where code = p_code
  for update;

  if not found or room_row.status <> 'active' or room_row.expires_at <= now() then
    raise exception 'Room is closed or expired';
  end if;

  if room_row.admin_participant_id <> p_current_admin_id then
    raise exception 'Only the current room admin can transfer admin control';
  end if;

  if not exists (
    select 1
    from public.watch_room_participants
    where room_code = p_code
      and id = p_current_admin_id
      and left_at is null
      and last_seen_at > now() - interval '45 seconds'
  ) then
    raise exception 'Current room admin is no longer active';
  end if;

  if p_new_admin_id = p_current_admin_id or not exists (
    select 1
    from public.watch_room_participants
    where room_code = p_code
      and id = p_new_admin_id
      and left_at is null
      and last_seen_at > now() - interval '45 seconds'
  ) then
    raise exception 'Choose another active room participant';
  end if;

  update public.watch_rooms
  set admin_participant_id = p_new_admin_id,
      revision = revision + 1
  where code = p_code;
end;
$$;

revoke all on function public.transfer_watch_room_admin(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.transfer_watch_room_admin(text, uuid, uuid) to service_role;
