begin;

insert into public.app_config (key, value, is_public)
values ('latest_version', '"0.9.0-beta.3"'::jsonb, true)
on conflict (key) do update
set
  value = excluded.value,
  is_public = excluded.is_public,
  updated_at = now();

commit;
