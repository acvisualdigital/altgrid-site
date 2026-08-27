begin;

insert into public.games (
  slug,
  name,
  launch_url,
  developer_referral_url,
  icon_url,
  enabled,
  sort_order,
  metadata
)
values (
  'tib-idle',
  'Tib Idle',
  'https://play.tibidle.com/',
  null,
  null,
  true,
  3,
  '{}'::jsonb
)
on conflict (slug) do update
set
  name = excluded.name,
  launch_url = excluded.launch_url,
  developer_referral_url = excluded.developer_referral_url,
  icon_url = excluded.icon_url,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order,
  metadata = excluded.metadata,
  updated_at = now();

commit;
