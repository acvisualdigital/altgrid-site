insert into public.plans (
  code,
  name,
  max_accounts,
  enabled,
  is_lifetime_available,
  sort_order,
  entitlement_rank,
  features,
  metadata
)
values
  (
    'FREE', 'Free', 2, true, false, 10, 0,
    '{"basic_grids":true,"fullscreen_sessions":true,"game_presets":true,"advanced_grids":false,"eco_mode":false,"session_restore":false,"founder_badge":false,"beta_features":false}'::jsonb,
    '{}'::jsonb
  ),
  (
    'PRO', 'Pro', 6, true, true, 20, 100,
    '{"basic_grids":true,"fullscreen_sessions":true,"game_presets":true,"advanced_grids":true,"eco_mode":true,"session_restore":true,"founder_badge":false,"beta_features":false}'::jsonb,
    '{}'::jsonb
  ),
  (
    'FOUNDER', 'Founder', 2147483647, true, true, 30, 200,
    '{"basic_grids":true,"fullscreen_sessions":true,"game_presets":true,"advanced_grids":true,"eco_mode":true,"session_restore":true,"founder_badge":true,"beta_features":true}'::jsonb,
    '{}'::jsonb
  )
on conflict (code) do update
set
  max_accounts = excluded.max_accounts,
  entitlement_rank = excluded.entitlement_rank,
  features = excluded.features,
  updated_at = now();

insert into public.products (
  code,
  name,
  description,
  plan_id,
  price_amount,
  currency,
  lifetime,
  enabled,
  metadata
)
select
  seed.code,
  seed.name,
  seed.description,
  plans.id,
  seed.price_amount,
  'BRL',
  true,
  true,
  seed.metadata::jsonb
from (
  values
    ('PRO_LIFETIME', 'PRO Lifetime', 'Acesso vitalício ao plano PRO.', 'PRO', 19.90, '{}'),
    ('PRO_PLUS_LIFETIME', 'PLUS Lifetime', 'Acesso vitalício ao plano PLUS.', 'PRO_PLUS', 39.90, '{}'),
    ('PRO_PLUS_UPGRADE', 'PLUS Upgrade', 'Upgrade do PRO para o plano PLUS.', 'PRO_PLUS', 19.90, '{"upgrade_from":"PRO_LIFETIME","discount_amount":20.00}'),
    ('FOUNDER_LIFETIME', 'Founder Lifetime', 'Acesso vitalício ao plano Founder.', 'FOUNDER', 79.90, '{}'),
    ('FOUNDER_UPGRADE', 'Founder Upgrade', 'Upgrade do PRO para o plano Founder.', 'FOUNDER', 59.90, '{"upgrade_from":"PRO_LIFETIME","discount_amount":20.00}'),
    ('PLUS_FOUNDER_UPGRADE', 'Founder Upgrade PLUS', 'Upgrade do PLUS para o plano Founder.', 'FOUNDER', 39.90, '{"upgrade_from":"PRO_PLUS_LIFETIME","discount_amount":40.00}')
) as seed(code, name, description, plan_code, price_amount, metadata)
join public.plans on plans.code = seed.plan_code
on conflict (code) do update
set
  price_amount = excluded.price_amount,
  currency = excluded.currency,
  lifetime = excluded.lifetime,
  enabled = excluded.enabled,
  metadata = excluded.metadata,
  updated_at = now();

insert into public.app_config (key, value)
values
  ('referral_referrer_days', '1'::jsonb),
  ('referral_referred_days', '1'::jsonb),
  ('founder_max_sales', 'null'::jsonb)
on conflict (key) do nothing;
