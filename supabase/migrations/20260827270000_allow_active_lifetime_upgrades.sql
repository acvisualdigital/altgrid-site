begin;

create or replace function public.validate_lifetime_upgrade_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  required_plan text;
begin
  if new.product_code in ('PRO_PLUS_UPGRADE', 'FOUNDER_UPGRADE') then
    required_plan := 'PRO';
  elsif new.product_code = 'PLUS_FOUNDER_UPGRADE' then
    required_plan := 'PRO_PLUS';
  else
    return new;
  end if;

  if not exists (
    select 1
    from public.licenses as license
    join public.plans as plan on plan.id = license.plan_id
    where license.user_id = new.user_id
      and license.status = 'active'
      and license.lifetime
      and license.starts_at <= now()
      and (license.expires_at is null or license.expires_at > now())
      and plan.code = required_plan
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'lifetime upgrade requires the previous lifetime plan';
  end if;

  return new;
end;
$$;

create or replace function public.validate_lifetime_upgrade_license()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_id uuid;
  upgrade_product_code text;
  required_plan text;
begin
  if new.source is null or new.source not like 'payment:%' then
    return new;
  end if;

  payment_id := substring(new.source from 9)::uuid;
  select payment.product_code
  into upgrade_product_code
  from public.payments as payment
  where payment.id = payment_id
    and payment.user_id = new.user_id
    and payment.status = 'paid';

  if upgrade_product_code in ('PRO_PLUS_UPGRADE', 'FOUNDER_UPGRADE') then
    required_plan := 'PRO';
  elsif upgrade_product_code = 'PLUS_FOUNDER_UPGRADE' then
    required_plan := 'PRO_PLUS';
  else
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'altgrid:upgrade:' || new.user_id::text,
    0
  ));

  if exists (
    select 1
    from public.licenses as previous_license
    join public.plans as previous_plan
      on previous_plan.id = previous_license.plan_id
    where previous_license.user_id = new.user_id
      and previous_license.status = 'active'
      and previous_license.lifetime
      and previous_license.starts_at <= now()
      and (previous_license.expires_at is null or previous_license.expires_at > now())
      and previous_plan.code = required_plan
      and not exists (
        select 1
        from public.licenses as used_license
        join public.payments as used_payment
          on used_license.source = 'payment:' || used_payment.id::text
        where used_license.user_id = new.user_id
          and used_payment.product_code = upgrade_product_code
      )
  ) then
    return new;
  end if;

  raise exception using
    errcode = 'P0001',
    message = 'lifetime upgrade eligibility lost';
end;
$$;

commit;
