begin;

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
  'PRO_TEST_R1',
  'Teste administrativo PRO',
  'Produto de valor reduzido para validar a ativação do plano PRO pela conta administradora.',
  id,
  1.00,
  'BRL',
  true,
  true,
  '{"internal_test":true,"owner_email":"yacaciio@gmail.com"}'::jsonb
from public.plans
where code = 'PRO'
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    plan_id = excluded.plan_id,
    price_amount = excluded.price_amount,
    currency = excluded.currency,
    lifetime = excluded.lifetime,
    enabled = excluded.enabled,
    metadata = excluded.metadata,
    updated_at = now();

commit;
