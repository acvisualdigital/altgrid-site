begin;

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
  required_product text;
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

  if upgrade_product_code = 'PRO_PLUS_UPGRADE' then
    required_plan := 'PRO';
    required_product := 'PRO_LIFETIME';
  elsif upgrade_product_code = 'PLUS_FOUNDER_UPGRADE' then
    required_plan := 'PRO_PLUS';
    required_product := 'PRO_PLUS_LIFETIME';
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
    join public.payments as previous_payment
      on previous_license.source = 'payment:' || previous_payment.id::text
    where previous_license.user_id = new.user_id
      and previous_plan.code = required_plan
      and previous_payment.product_code = required_product
      and previous_payment.status = 'paid'
      and previous_payment.fulfilled_at is not null
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

drop trigger if exists validate_lifetime_upgrade_license on public.licenses;
create trigger validate_lifetime_upgrade_license
before insert on public.licenses
for each row execute function public.validate_lifetime_upgrade_license();

create or replace function public.revoke_license_on_payment_reversal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('refunded', 'charged_back')
    and old.status is distinct from new.status then
    update public.licenses
    set status = 'revoked', updated_at = now()
    where source = 'payment:' || new.id::text
      and status = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists revoke_license_on_payment_reversal on public.payments;
create trigger revoke_license_on_payment_reversal
after update of status on public.payments
for each row execute function public.revoke_license_on_payment_reversal();

commit;
