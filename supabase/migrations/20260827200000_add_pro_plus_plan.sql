begin;

update public.plans
set max_accounts = case code
  when 'PRO' then 6
  when 'FOUNDER' then 20
  else max_accounts
end,
updated_at = now()
where code in ('PRO', 'FOUNDER');

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
values (
  'PRO_PLUS',
  'PLUS',
  10,
  true,
  true,
  25,
  150,
  '{
    "basic_grids": true,
    "fullscreen_sessions": true,
    "game_presets": true,
    "advanced_grids": true,
    "eco_mode": true,
    "session_restore": true,
    "founder_badge": false,
    "beta_features": false
  }'::jsonb,
  '{}'::jsonb
)
on conflict (code) do update
set name = excluded.name,
    max_accounts = excluded.max_accounts,
    enabled = excluded.enabled,
    is_lifetime_available = excluded.is_lifetime_available,
    sort_order = excluded.sort_order,
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
  'PRO_PLUS_LIFETIME',
  'PRO Plus Lifetime',
  'Acesso vitalício ao plano PRO Plus.',
  id,
  49.99,
  'BRL',
  true,
  true,
  '{}'::jsonb
from public.plans
where code = 'PRO_PLUS'
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    plan_id = excluded.plan_id,
    price_amount = excluded.price_amount,
    currency = excluded.currency,
    lifetime = excluded.lifetime,
    enabled = excluded.enabled,
    updated_at = now();

commit;
