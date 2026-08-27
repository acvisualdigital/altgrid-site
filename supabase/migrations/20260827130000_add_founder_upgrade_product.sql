begin;

insert into public.products (
  code, name, description, plan_id, price_amount, currency, lifetime, enabled, metadata
)
select
  'FOUNDER_UPGRADE',
  'Founder Upgrade',
  'Upgrade do PRO para o plano Founder.',
  id,
  75.00,
  'BRL',
  true,
  true,
  '{"upgrade_from":"PRO_LIFETIME","discount_amount":24.99}'::jsonb
from public.plans
where code = 'FOUNDER'
on conflict (code) do update
set price_amount = excluded.price_amount,
    currency = excluded.currency,
    lifetime = excluded.lifetime,
    enabled = excluded.enabled,
    metadata = excluded.metadata,
    updated_at = now();

commit;