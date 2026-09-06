begin;

create or replace function public.create_pending_mercadopago_card_payment(
  p_user_id uuid,
  p_product_code text,
  p_request_key text,
  p_processing_fee_percent numeric default 20
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_payment public.payments;
  seeded jsonb;
  seeded_id uuid;
  internal_request_key text;
  base_amount numeric;
  processing_fee numeric;
begin
  if p_processing_fee_percent is null
    or p_processing_fee_percent < 0
    or p_processing_fee_percent > 100 then
    raise exception using errcode = '22023', message = 'invalid processing fee percent';
  end if;
  if p_request_key is null
    or btrim(p_request_key) = ''
    or char_length(p_request_key) > 180 then
    raise exception using errcode = '22023', message = 'invalid request key';
  end if;

  internal_request_key := 'card:' || p_request_key;
  seeded := public.create_pending_mercadopago_payment(
    p_user_id,
    p_product_code,
    internal_request_key
  );
  seeded_id := (seeded ->> 'id')::uuid;

  select * into local_payment
  from public.payments
  where id = seeded_id and provider = 'mercadopago'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'payment could not be prepared';
  end if;
  if local_payment.product_code <> p_product_code then
    raise exception using errcode = '23505', message = 'request key already belongs to another product';
  end if;

  if coalesce(local_payment.metadata ->> 'payment_method', '') = 'card' then
    return to_jsonb(local_payment);
  end if;
  if local_payment.provider_payment_id is not null or local_payment.fulfilled_at is not null then
    raise exception using errcode = '23505', message = 'payment method cannot be changed';
  end if;

  base_amount := local_payment.amount;
  processing_fee := round(base_amount * p_processing_fee_percent / 100, 2);
  update public.payments
  set
    amount = base_amount + processing_fee,
    metadata = metadata || jsonb_build_object(
      'payment_method', 'card',
      'base_amount', base_amount,
      'processing_fee', processing_fee,
      'processing_fee_percent', p_processing_fee_percent,
      'processing_fee_currency', 'BRL'
    )
  where id = local_payment.id
  returning * into local_payment;

  return to_jsonb(local_payment);
end;
$$;

create or replace function public.attach_mercadopago_checkout(
  p_user_id uuid,
  p_payment_id uuid,
  p_preference_id text,
  p_expires_at timestamptz,
  p_checkout_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.payments;
begin
  if p_preference_id is null
    or btrim(p_preference_id) = ''
    or char_length(p_preference_id) > 200
    or p_checkout_url is null
    or btrim(p_checkout_url) = ''
    or char_length(p_checkout_url) > 2000
    or p_expires_at is null then
    raise exception using errcode = '22023', message = 'invalid checkout data';
  end if;

  update public.payments
  set
    status = 'pending',
    raw_status = 'preference_created',
    failure_reason = null,
    provider_expires_at = p_expires_at,
    metadata = metadata || jsonb_build_object('checkout', jsonb_build_object(
      'checkout_url', p_checkout_url,
      'preference_id', p_preference_id
    ))
  where id = p_payment_id
    and user_id = p_user_id
    and provider = 'mercadopago'
    and metadata ->> 'payment_method' = 'card'
    and provider_payment_id is null
    and fulfilled_at is null
    and (
      metadata -> 'checkout' ->> 'preference_id' is null
      or metadata -> 'checkout' ->> 'preference_id' = p_preference_id
    )
  returning * into updated;

  if not found then
    raise exception using errcode = 'P0002', message = 'payment not found';
  end if;
  return to_jsonb(updated);
end;
$$;

revoke all on function public.create_pending_mercadopago_card_payment(uuid, text, text, numeric)
from public, anon, authenticated;
revoke all on function public.attach_mercadopago_checkout(uuid, uuid, text, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.create_pending_mercadopago_card_payment(uuid, text, text, numeric)
to service_role;
grant execute on function public.attach_mercadopago_checkout(uuid, uuid, text, timestamptz, text)
to service_role;

commit;
