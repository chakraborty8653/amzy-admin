alter table public.native_login_challenges
  add column if not exists verified_uid text;
