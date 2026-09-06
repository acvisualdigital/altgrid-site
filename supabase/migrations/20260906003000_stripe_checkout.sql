begin;

create or replace function public.create_pending_stripe_payment(
  p_user_id uuid,
  p_product_code text,
  p_request_key text,
  p_processing_fee numeric default 12.00
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
  if p_processing_fee is null or p_processing_fee < 0 or p_processing_fee > 100 then
    raise exception using errcode = '22023', message = 'invalid processing fee';
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
    amount = amount + round(p_processing_fee, 2),
    metadata = metadata || jsonb_build_object(
      'base_amount', amount,
      'processing_fee', round(p_processing_fee, 2),
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

create or replace function public.attach_stripe_checkout(
  p_user_id uuid,
  p_payment_id uuid,
  p_checkout_session_id text,
  p_expires_at timestamptz,
  p_checkout_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare updated public.payments;
begin
  update public.payments set
    provider_payment_id = p_checkout_session_id,
    raw_status = 'open',
    provider_expires_at = p_expires_at,
    metadata = metadata || jsonb_build_object('checkout', jsonb_build_object(
      'checkout_url', p_checkout_url
    ))
  where id = p_payment_id and user_id = p_user_id and provider = 'stripe'
    and (provider_payment_id is null or provider_payment_id = p_checkout_session_id)
    and fulfilled_at is null
  returning * into updated;
  if not found then
    raise exception using errcode = 'P0002', message = 'payment not found';
  end if;
  return to_jsonb(updated);
end;
$$;

create or replace function public.process_stripe_checkout(
  p_checkout_session_id text,
  p_external_reference uuid,
  p_provider_status text,
  p_amount numeric,
  p_currency text,
  p_paid_at timestamptz,
  p_event_id text,
  p_payload_hash text,
  p_provider_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_payment public.payments;
  original_request_key text;
  mapped_status text;
  result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'altgrid:stripe-payment:' || p_external_reference::text, 0
  ));
  select * into local_payment from public.payments
  where id = p_external_reference and provider = 'stripe' for update;
  if not found then raise exception using errcode = 'P0002', message = 'payment not found'; end if;

  mapped_status := case p_provider_status
    when 'paid' then 'approved'
    when 'open' then 'pending'
    when 'expired' then 'cancelled'
    when 'refunded' then 'refunded'
    else 'rejected'
  end;
  original_request_key := local_payment.request_key;
  update public.payments set provider = 'mercadopago', request_key = null
  where id = local_payment.id;

  result := public.process_mercadopago_payment(
    p_checkout_session_id, p_external_reference, mapped_status, p_amount,
    upper(p_currency), p_paid_at, 'stripe:' || p_event_id, p_payload_hash,
    p_provider_data
  );

  update public.payments set provider = 'stripe', request_key = original_request_key
  where id = local_payment.id;
  return result;
end;
$$;

revoke all on function public.create_pending_stripe_payment(uuid, text, text, numeric) from public, anon, authenticated;
revoke all on function public.attach_stripe_checkout(uuid, uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.process_stripe_checkout(text, uuid, text, numeric, text, timestamptz, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_pending_stripe_payment(uuid, text, text, numeric) to service_role;
grant execute on function public.attach_stripe_checkout(uuid, uuid, text, timestamptz, text) to service_role;
grant execute on function public.process_stripe_checkout(text, uuid, text, numeric, text, timestamptz, text, text, jsonb) to service_role;

commit;
