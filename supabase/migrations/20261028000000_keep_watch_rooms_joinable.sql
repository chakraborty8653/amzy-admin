create or replace function public.join_watch_room(
  p_code text,
  p_participant_id uuid,
  p_nickname text,
  p_platform text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.watch_rooms%rowtype;
  active_count integer;
begin
  if p_platform not in ('android', 'browser') then
    raise exception 'Invalid room platform';
  end if;

  select * into room_row
  from public.watch_rooms
  where code = p_code
  for update;

  if not found or room_row.status <> 'active' or room_row.expires_at <= now() then
    raise exception 'Room is closed or expired';
  end if;

  if room_row.video is not null
    and coalesce(room_row.video->>'videoUrl', '') = ''
    and coalesce(room_row.video->>'rawVideoUrl', '') = ''
    and p_platform <> 'android' then
    raise exception 'This private Telegram video room is Android-only';
  end if;

  select count(*) into active_count
  from public.watch_room_participants
  where room_code = p_code
    and left_at is null
    and last_seen_at > now() - interval '45 seconds';

  if active_count >= 10 then
    raise exception 'This room already has 10 active participants';
  end if;

  insert into public.watch_room_participants (id, room_code, nickname, platform)
  values (p_participant_id, p_code, p_nickname, p_platform);
end;
$$;

revoke all on function public.join_watch_room(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.join_watch_room(text, uuid, text, text) to service_role;

update public.watch_rooms as rooms
set status = 'active'
where rooms.status = 'closed'
  and rooms.expires_at > now()
  and exists (
    select 1
    from public.watch_room_participants as admin
    where admin.room_code = rooms.code
      and admin.id = rooms.admin_participant_id
      and admin.left_at is null
  );
