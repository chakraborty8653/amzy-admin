drop function if exists public.set_watch_room_voice(text, uuid, boolean);

alter table public.watch_rooms
  drop column if exists voice_enabled;
