begin;

create or replace function public.validate_lifetime_upgrade_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  required_plan text;
  required_product text;
begin
  if new.product_code = 'PRO_PLUS_UPGRADE' then
    required_plan := 'PRO';
    required_product := 'PRO_LIFETIME';
  elsif new.product_code = 'PLUS_FOUNDER_UPGRADE' then
    required_plan := 'PRO_PLUS';
    required_product := 'PRO_PLUS_LIFETIME';
  else
    return new;
  end if;

  if not exists (
    select 1
    from public.licenses as license
    join public.plans as plan on plan.id = license.plan_id
    join public.payments as payment
      on license.source = 'payment:' || payment.id::text
      and payment.user_id = license.user_id
    where license.user_id = new.user_id
      and license.status = 'active'
      and license.lifetime
      and license.starts_at <= now()
      and (license.expires_at is null or license.expires_at > now())
      and plan.code = required_plan
      and payment.product_code = required_product
      and payment.status = 'paid'
      and payment.fulfilled_at is not null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lifetime upgrade requires the previous lifetime plan';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_lifetime_upgrade_payment on public.payments;
create trigger validate_lifetime_upgrade_payment
before insert on public.payments
for each row execute function public.validate_lifetime_upgrade_payment();

create or replace function public.admin_update_product(
  p_actor_user_id uuid,
  p_code text,
  p_price_amount numeric,
  p_currency text,
  p_enabled boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_code text := upper(btrim(p_code));
  normalized_currency text := upper(btrim(p_currency));
  before_product public.products%rowtype;
  after_product public.products%rowtype;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  if normalized_code not in (
    'PRO_LIFETIME', 'PRO_PLUS_LIFETIME', 'PRO_PLUS_UPGRADE',
    'FOUNDER_LIFETIME', 'FOUNDER_UPGRADE', 'PLUS_FOUNDER_UPGRADE'
  ) then
    raise invalid_parameter_value using message = 'Product is not administrable';
  end if;

  if p_price_amount is not null and p_price_amount < 0 then
    raise check_violation using message = 'Product price must be nonnegative';
  end if;
  if coalesce(p_enabled, false) and p_price_amount is null then
    raise check_violation using message = 'An enabled product requires a price';
  end if;
  if normalized_currency !~ '^[A-Z]{3}$' then
    raise check_violation using message = 'Currency must be a three-letter ISO code';
  end if;

  select * into before_product
  from public.products where code = normalized_code for update;
  if not found then
    raise no_data_found using message = 'Product does not exist';
  end if;

  update public.products
  set price_amount = p_price_amount, currency = normalized_currency,
      enabled = coalesce(p_enabled, false), updated_at = now()
  where code = normalized_code
  returning * into after_product;

  perform public.admin_write_audit(
    p_actor_user_id, 'product.update', 'product', normalized_code,
    to_jsonb(before_product), to_jsonb(after_product)
  );
  return jsonb_build_object(
    'before', to_jsonb(before_product), 'after', to_jsonb(after_product)
  );
end;
$$;

insert into public.products (
  code, name, description, plan_id, price_amount, currency, lifetime, enabled, metadata
)
select seed.code, seed.name, seed.description, plans.id, seed.price_amount,
  'BRL', true, true, seed.metadata::jsonb
from (
  values
    ('PRO_PLUS_UPGRADE', 'PLUS Upgrade', 'Upgrade do PRO para o plano PLUS.', 'PRO_PLUS', 19.90, '{"upgrade_from":"PRO_LIFETIME","discount_amount":19.90}'),
    ('PLUS_FOUNDER_UPGRADE', 'Founder Upgrade PLUS', 'Upgrade do PLUS para o plano Founder.', 'FOUNDER', 39.90, '{"upgrade_from":"PRO_PLUS_LIFETIME","discount_amount":39.90}')
) as seed(code, name, description, plan_code, price_amount, metadata)
join public.plans on plans.code = seed.plan_code
on conflict (code) do update
set price_amount = excluded.price_amount,
    currency = excluded.currency,
    lifetime = excluded.lifetime,
    enabled = excluded.enabled,
    metadata = excluded.metadata,
    updated_at = now();

update public.products
set
  price_amount = case code
    when 'PRO_LIFETIME' then 19.90
    when 'PRO_PLUS_LIFETIME' then 39.90
    when 'PRO_PLUS_UPGRADE' then 19.90
    when 'FOUNDER_LIFETIME' then 79.90
    when 'FOUNDER_UPGRADE' then 59.90
    when 'PLUS_FOUNDER_UPGRADE' then 39.90
  end,
  currency = 'BRL',
  lifetime = true,
  enabled = true,
  metadata = case code
    when 'FOUNDER_UPGRADE' then '{"upgrade_from":"PRO_LIFETIME","discount_amount":19.90}'::jsonb
    when 'PRO_PLUS_UPGRADE' then '{"upgrade_from":"PRO_LIFETIME","discount_amount":19.90}'::jsonb
    when 'PLUS_FOUNDER_UPGRADE' then '{"upgrade_from":"PRO_PLUS_LIFETIME","discount_amount":39.90}'::jsonb
    else metadata
  end,
  updated_at = now()
where code in (
  'PRO_LIFETIME',
  'PRO_PLUS_LIFETIME',
  'PRO_PLUS_UPGRADE',
  'FOUNDER_LIFETIME',
  'FOUNDER_UPGRADE',
  'PLUS_FOUNDER_UPGRADE'
);

commit;