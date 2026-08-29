begin;

insert into public.app_config (key, value, is_public)
values
  ('latest_version', '"1.1.2"'::jsonb, true),
  ('update_channel', '"stable"'::jsonb, true)
on conflict (key) do update
set
  value = excluded.value,
  is_public = excluded.is_public,
  updated_at = now();

commit;
