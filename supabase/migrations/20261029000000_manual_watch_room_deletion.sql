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

  if not exists (
    select 1
    from public.watch_room_participants
    where room_code = p_code
      and id = room_row.admin_participant_id
      and left_at is null
      and last_seen_at > now() - interval '45 seconds'
  ) then
    update public.watch_rooms
    set admin_participant_id = p_participant_id,
        is_playing = false,
        revision = revision + 1
    where code = p_code;
  end if;
end;
$$;

create or replace function public.leave_watch_room(
  p_code text,
  p_participant_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.watch_rooms%rowtype;
  replacement_admin_id uuid;
begin
  select * into room_row
  from public.watch_rooms
  where code = p_code
  for update;

  if not found or room_row.status <> 'active' or room_row.expires_at <= now() then
    raise exception 'Room is closed or expired';
  end if;

  if not exists (
    select 1
    from public.watch_room_participants
    where id = p_participant_id
      and room_code = p_code
      and left_at is null
  ) then
    raise exception 'This room session is invalid. Rejoin the room.';
  end if;

  if room_row.admin_participant_id = p_participant_id then
    select id into replacement_admin_id
    from public.watch_room_participants
    where room_code = p_code
      and id <> p_participant_id
      and left_at is null
      and last_seen_at > now() - interval '45 seconds'
    order by joined_at
    limit 1;

    if replacement_admin_id is not null then
      update public.watch_rooms
      set admin_participant_id = replacement_admin_id,
          is_playing = false,
          revision = revision + 1
      where code = p_code;
    else
      update public.watch_rooms
      set is_playing = false,
          revision = revision + 1
      where code = p_code;
    end if;
  end if;

  update public.watch_room_participants
  set left_at = now(),
      last_seen_at = now()
  where id = p_participant_id
    and room_code = p_code;
end;
$$;

create or replace function public.delete_watch_room(
  p_code text,
  p_admin_participant_id uuid
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
    raise exception 'Only the room admin can delete this room';
  end if;

  update public.watch_rooms
  set status = 'closed',
      is_playing = false,
      revision = revision + 1
  where code = p_code;
end;
$$;

revoke all on function public.join_watch_room(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.leave_watch_room(text, uuid) from public, anon, authenticated;
revoke all on function public.delete_watch_room(text, uuid) from public, anon, authenticated;
grant execute on function public.join_watch_room(text, uuid, text, text) to service_role;
grant execute on function public.leave_watch_room(text, uuid) to service_role;
grant execute on function public.delete_watch_room(text, uuid) to service_role;
