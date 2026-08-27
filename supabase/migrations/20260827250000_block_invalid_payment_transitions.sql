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
  elsif new.product_code = 'FOUNDER_UPGRADE' then
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

create or replace function public.block_reversed_payment_reapproval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('refunded', 'charged_back', 'cancelled', 'refund_required')
    and new.status = 'paid' then
    raise exception using
      errcode = 'P0001',
      message = 'terminal payment status cannot be reapproved';
  end if;
  return new;
end;
$$;

drop trigger if exists block_reversed_payment_reapproval on public.payments;
create trigger block_reversed_payment_reapproval
before update of status on public.payments
for each row execute function public.block_reversed_payment_reapproval();

commit;
