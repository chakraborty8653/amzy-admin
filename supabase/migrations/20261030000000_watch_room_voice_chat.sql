alter table public.watch_rooms
  add column if not exists voice_enabled boolean not null default false;

create or replace function public.set_watch_room_voice(
  p_code text,
  p_admin_participant_id uuid,
  p_enabled boolean
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

  if room_row.admin_participant_id <> p_admin_participant_id then
    raise exception 'Only the room admin can control voice chat';
  end if;

  update public.watch_rooms
  set voice_enabled = p_enabled,
      revision = revision + 1
  where code = p_code;
end;
$$;

revoke all on function public.set_watch_room_voice(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_watch_room_voice(text, uuid, boolean) to service_role;
