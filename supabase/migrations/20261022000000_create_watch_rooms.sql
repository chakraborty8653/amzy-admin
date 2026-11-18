create table if not exists public.watch_rooms (
  code text primary key check (code ~ '^[A-Z2-9]{10}$'),
  admin_participant_id uuid not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  video jsonb,
  current_time_seconds double precision not null default 0 check (current_time_seconds >= 0),
  is_playing boolean not null default false,
  revision bigint not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours')
);

create table if not exists public.watch_room_participants (
  id uuid primary key,
  room_code text not null references public.watch_rooms(code) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 32),
  platform text not null check (platform in ('android', 'browser')),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz
);

create index if not exists watch_room_participants_room_seen_idx
  on public.watch_room_participants (room_code, last_seen_at desc);

alter table public.watch_rooms enable row level security;
alter table public.watch_room_participants enable row level security;

revoke all on table public.watch_rooms, public.watch_room_participants from anon, authenticated;
grant all on table public.watch_rooms, public.watch_room_participants to service_role;

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

  if not exists (
    select 1
    from public.watch_room_participants
    where room_code = p_code
      and id = room_row.admin_participant_id
      and left_at is null
      and last_seen_at > now() - interval '45 seconds'
  ) then
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

create or replace function public.set_watch_room_playback(
  p_code text,
  p_participant_id uuid,
  p_video jsonb,
  p_current_time double precision,
  p_is_playing boolean
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

  if room_row.admin_participant_id <> p_participant_id then
    raise exception 'Only the room admin can control playback';
  end if;

  if coalesce(p_video->>'videoUrl', '') = ''
    and coalesce(p_video->>'rawVideoUrl', '') = ''
    and exists (
      select 1
      from public.watch_room_participants
      where room_code = p_code
        and left_at is null
        and last_seen_at > now() - interval '45 seconds'
        and platform = 'browser'
    ) then
    raise exception 'Private Telegram video rooms can only include Android participants';
  end if;

  update public.watch_rooms
  set video = p_video,
      current_time_seconds = greatest(0, p_current_time),
      is_playing = p_is_playing,
      revision = revision + 1,
      expires_at = now() + interval '12 hours'
  where code = p_code;
end;
$$;

revoke all on function public.join_watch_room(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_watch_room_playback(text, uuid, jsonb, double precision, boolean) from public, anon, authenticated;
grant execute on function public.join_watch_room(text, uuid, text, text) to service_role;
grant execute on function public.set_watch_room_playback(text, uuid, jsonb, double precision, boolean) to service_role;
