begin;

create or replace function public.create_pending_stripe_payment_v2(
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
begin
  if p_processing_fee_percent is null
    or p_processing_fee_percent < 0
    or p_processing_fee_percent > 100 then
    raise exception using errcode = '22023', message = 'invalid processing fee percent';
  end if;
  if p_request_key is null or btrim(p_request_key) = '' or char_length(p_request_key) > 180 then
    raise exception using errcode = '22023', message = 'invalid request key';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'altgrid:stripe-request:' || p_user_id::text || ':' || p_request_key, 0
  ));
  select * into local_payment from public.payments
  where user_id = p_user_id and provider = 'stripe' and request_key = p_request_key;
  if found then
    if local_payment.product_code <> p_product_code then
      raise exception using errcode = '23505', message = 'request key already belongs to another product';
    end if;
    return to_jsonb(local_payment);
  end if;

  internal_request_key := 'stripe:' || p_request_key;
  seeded := public.create_pending_mercadopago_payment(
    p_user_id, p_product_code, internal_request_key
  );
  seeded_id := (seeded ->> 'id')::uuid;

  update public.payments set
    provider = 'stripe',
    request_key = p_request_key,
    amount = amount + round(amount * p_processing_fee_percent / 100, 2),
    metadata = metadata || jsonb_build_object(
      'base_amount', amount,
      'processing_fee', round(amount * p_processing_fee_percent / 100, 2),
      'processing_fee_percent', p_processing_fee_percent,
      'processing_fee_currency', 'BRL'
    )
  where id = seeded_id and provider = 'mercadopago' and provider_payment_id is null
  returning * into local_payment;
  if not found then
    raise exception using errcode = 'P0002', message = 'payment could not be prepared';
  end if;
  return to_jsonb(local_payment);
end;
$$;

revoke all on function public.create_pending_stripe_payment_v2(uuid, text, text, numeric)
from public, anon, authenticated;
grant execute on function public.create_pending_stripe_payment_v2(uuid, text, text, numeric)
to service_role;

commit;
