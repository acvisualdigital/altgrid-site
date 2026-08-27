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
    'PRO', 'Pro', 10, true, true, 20, 100,
    '{"basic_grids":true,"fullscreen_sessions":true,"game_presets":true,"advanced_grids":true,"eco_mode":true,"session_restore":true,"founder_badge":false,"beta_features":false}'::jsonb,
    '{}'::jsonb
  ),
  (
    'FOUNDER', 'Founder', 20, true, true, 30, 200,
    '{"basic_grids":true,"fullscreen_sessions":true,"game_presets":true,"advanced_grids":true,"eco_mode":true,"session_restore":true,"founder_badge":true,"beta_features":true}'::jsonb,
    '{}'::jsonb
  )
on conflict (code) do update
set
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
  '{}'::jsonb
from (
  values
    ('PRO_LIFETIME', 'PRO Lifetime', 'Acesso vitalício ao plano PRO.', 'PRO', 24.99),
    ('FOUNDER_LIFETIME', 'Founder Lifetime', 'Acesso vitalício ao plano Founder.', 'FOUNDER', 99.99)
) as seed(code, name, description, plan_code, price_amount)
join public.plans on plans.code = seed.plan_code
on conflict (code) do update
set
  price_amount = excluded.price_amount,
  currency = excluded.currency,
  lifetime = excluded.lifetime,
  enabled = excluded.enabled,
  updated_at = now();

insert into public.app_config (key, value)
values
  ('referral_referrer_days', '1'::jsonb),
  ('referral_referred_days', '1'::jsonb),
  ('founder_max_sales', 'null'::jsonb)
on conflict (key) do nothing;
