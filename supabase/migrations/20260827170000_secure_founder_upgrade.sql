begin;

-- The discounted upgrade is only available while the user still owns the
-- active PRO license created by a completed PRO_LIFETIME payment. Temporary
-- PRO access and manually granted lifetime licenses do not represent a paid
-- upgrade credit.
create or replace function public.has_pro_lifetime_upgrade_eligibility(
  p_user_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  eligible boolean := false;
begin
  select true
  into eligible
  from public.licenses as license
  join public.plans as plan
    on plan.id = license.plan_id
  join public.payments as payment
    on license.source = 'payment:' || payment.id::text
    and payment.user_id = license.user_id
  where license.user_id = p_user_id
    and license.status = 'active'
    and license.lifetime
    and license.starts_at <= now()
    and (license.expires_at is null or license.expires_at > now())
    and plan.code = 'PRO'
    and payment.product_code = 'PRO_LIFETIME'
    and payment.status = 'paid'
    and payment.fulfilled_at is not null
  limit 1
  for update of license, payment;

  return coalesce(eligible, false);
end;
$$;

create or replace function public.create_pending_mercadopago_payment(
  p_user_id uuid,
  p_product_code text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_product record;
  local_payment public.payments;
  local_id uuid := gen_random_uuid();
  sales_limit integer;
  reserved_sales integer;
begin
  if p_request_key is null
    or btrim(p_request_key) = ''
    or char_length(p_request_key) > 200 then
    raise exception using errcode = '22023', message = 'invalid request key';
  end if;

  -- Preserve idempotent retries when Founder availability changed after the
  -- original reservation. Unattached upgrade rows are still revalidated so
  -- a pre-migration reservation cannot bypass the new eligibility rule.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'altgrid:payment-request:' || p_user_id::text || ':' || p_request_key,
    0
  ));

  select * into local_payment
  from public.payments
  where user_id = p_user_id
    and provider = 'mercadopago'
    and request_key = p_request_key;

  if found then
    if local_payment.product_code <> p_product_code then
      raise exception using
        errcode = '23505',
        message = 'request key already belongs to another product';
    end if;

    if local_payment.product_code = 'FOUNDER_UPGRADE'
      and local_payment.provider_payment_id is null then
      perform pg_advisory_xact_lock(hashtextextended('altgrid:founder-sales', 0));
      if not public.has_pro_lifetime_upgrade_eligibility(p_user_id) then
        raise exception using
          errcode = 'P0001',
          message = 'founder upgrade requires pro lifetime';
      end if;
    end if;

    return to_jsonb(local_payment);
  end if;

  select
    pr.code, pr.name, pr.description, pr.price_amount, pr.currency,
    pr.lifetime, pr.enabled, pl.code as plan_code
  into selected_product
  from public.products pr
  join public.plans pl on pl.id = pr.plan_id
  where pr.code = p_product_code;

  if not found or not selected_product.enabled
    or selected_product.price_amount is null
    or selected_product.price_amount <= 0
    or selected_product.currency <> 'BRL'
    or not selected_product.lifetime
    or selected_product.plan_code not in ('PRO', 'FOUNDER') then
    raise exception using errcode = 'P0002', message = 'product unavailable';
  end if;

  if selected_product.plan_code = 'FOUNDER' then
    perform pg_advisory_xact_lock(hashtextextended('altgrid:founder-sales', 0));

    -- Eligibility is checked while holding the same lock used by fulfillment,
    -- so a concurrent upgrade cannot consume the paid PRO credit in between.
    if selected_product.code = 'FOUNDER_UPGRADE'
      and not public.has_pro_lifetime_upgrade_eligibility(p_user_id) then
      raise exception using
        errcode = 'P0001',
        message = 'founder upgrade requires pro lifetime';
    end if;

    sales_limit := public.founder_sales_limit();
    if sales_limit is not null then
      select count(*) into reserved_sales
      from public.payments
      where product_code in ('FOUNDER_LIFETIME', 'FOUNDER_UPGRADE')
        and (
          fulfilled_at is not null
          or (
            status in ('pending', 'in_process')
            and created_at > now() - interval '30 minutes'
          )
        );
      if reserved_sales >= sales_limit then
        raise exception using errcode = 'P0001', message = 'founder sold out';
      end if;
    end if;
  end if;

  insert into public.payments (
    id, user_id, provider, provider_external_reference, product_code,
    amount, currency, status, raw_status, request_key, metadata
  ) values (
    local_id, p_user_id, 'mercadopago', local_id::text, selected_product.code,
    selected_product.price_amount, selected_product.currency, 'pending',
    'pending', p_request_key, jsonb_build_object(
      'product_name', selected_product.name,
      'plan_code', selected_product.plan_code
    )
  )
  on conflict (user_id, provider, request_key) where request_key is not null
  do update set request_key = excluded.request_key
  returning * into local_payment;

  return to_jsonb(local_payment);
end;
$$;

create or replace function public.process_mercadopago_payment(
  p_provider_payment_id text,
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
  selected_product record;
  selected_plan_id uuid;
  selected_plan_code text;
  assigned_founder_number integer;
  sales_limit integer;
  completed_sales integer;
  inserted_event_id uuid;
  existing_event public.payment_events;
begin
  if p_event_id is null
    or btrim(p_event_id) = ''
    or char_length(p_event_id) > 300 then
    raise exception using errcode = '22023', message = 'invalid event id';
  end if;

  if p_provider_payment_id is null
    or btrim(p_provider_payment_id) = ''
    or p_provider_status is null
    or btrim(p_provider_status) = ''
    or p_amount is null
    or p_currency is null
    or btrim(p_currency) = ''
    or p_payload_hash is null
    or btrim(p_payload_hash) = ''
    or p_provider_data is null then
    raise exception using errcode = '22023', message = 'invalid provider payment data';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'altgrid:payment:' || p_external_reference::text, 0
  ));

  select * into local_payment
  from public.payments
  where id = p_external_reference
    and provider = 'mercadopago'
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'payment not found';
  end if;

  insert into public.payment_events (
    provider, provider_event_id, payment_id, event_type,
    processed, payload_hash, metadata
  ) values (
    'mercadopago', p_event_id, local_payment.id, 'payment.' || p_provider_status,
    false, p_payload_hash, p_provider_data
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into inserted_event_id;

  if inserted_event_id is null then
    select * into existing_event
    from public.payment_events
    where provider = 'mercadopago'
      and provider_event_id = p_event_id;

    if existing_event.payment_id is distinct from local_payment.id
      or existing_event.payload_hash is distinct from p_payload_hash then
      raise exception using
        errcode = '23505',
        message = 'provider event id collision';
    end if;

    return jsonb_build_object(
      'payment_id', local_payment.id,
      'status', local_payment.status,
      'fulfilled', local_payment.fulfilled_at is not null,
      'duplicate', true
    );
  end if;

  if local_payment.provider_payment_id is not null
    and local_payment.provider_payment_id <> p_provider_payment_id then
    raise exception using errcode = '23505', message = 'provider payment mismatch';
  end if;

  if p_amount is distinct from local_payment.amount
    or upper(p_currency) is distinct from local_payment.currency then
    update public.payments
    set
      provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id),
      status = 'review_required',
      raw_status = p_provider_status,
      failure_reason = 'provider amount or currency mismatch'
    where id = local_payment.id;

    update public.payment_events
    set processed = true, processed_at = now()
    where id = inserted_event_id;

    return jsonb_build_object(
      'payment_id', local_payment.id,
      'status', 'review_required',
      'fulfilled', false,
      'duplicate', false
    );
  end if;

  update public.payments
  set
    provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id),
    status = case p_provider_status
      when 'approved' then 'paid'
      when 'pending' then 'pending'
      when 'in_process' then 'in_process'
      when 'refunded' then 'refunded'
      when 'charged_back' then 'charged_back'
      when 'cancelled' then 'cancelled'
      else 'rejected'
    end,
    raw_status = p_provider_status,
    paid_at = case when p_provider_status = 'approved'
      then coalesce(p_paid_at, paid_at, now()) else paid_at end
  where id = local_payment.id;

  if p_provider_status = 'approved' and local_payment.fulfilled_at is null then
    select pr.*, pl.id as selected_plan_id, pl.code as selected_plan_code
    into selected_product
    from public.products pr
    join public.plans pl on pl.id = pr.plan_id
    where pr.code = local_payment.product_code;

    if not found or not selected_product.lifetime
      or selected_product.selected_plan_code not in ('PRO', 'FOUNDER') then
      raise exception using errcode = 'P0002', message = 'fulfillment product invalid';
    end if;

    selected_plan_id := selected_product.selected_plan_id;
    selected_plan_code := selected_product.selected_plan_code;

    if selected_plan_code = 'FOUNDER' then
      perform pg_advisory_xact_lock(hashtextextended('altgrid:founder-sales', 0));

      -- Revalidate after serialization. Only one concurrent upgrade can
      -- consume the active PRO_LIFETIME license as its credit.
      if selected_product.code = 'FOUNDER_UPGRADE'
        and not public.has_pro_lifetime_upgrade_eligibility(local_payment.user_id) then
        update public.payments
        set
          status = 'refund_required',
          failure_reason = 'founder upgrade eligibility lost'
        where id = local_payment.id;
        update public.payment_events
        set processed = true, processed_at = now()
        where id = inserted_event_id;
        return jsonb_build_object(
          'payment_id', local_payment.id,
          'status', 'refund_required',
          'fulfilled', false,
          'duplicate', false
        );
      end if;

      sales_limit := public.founder_sales_limit();
      if sales_limit is not null then
        select count(*) into completed_sales
        from public.payments
        where product_code in ('FOUNDER_LIFETIME', 'FOUNDER_UPGRADE')
          and fulfilled_at is not null
          and id <> local_payment.id;
        if completed_sales >= sales_limit then
          update public.payments
          set status = 'refund_required', failure_reason = 'founder sales limit reached'
          where id = local_payment.id;
          update public.payment_events
          set processed = true, processed_at = now()
          where id = inserted_event_id;
          return jsonb_build_object(
            'payment_id', local_payment.id,
            'status', 'refund_required',
            'fulfilled', false,
            'duplicate', false
          );
        end if;
      end if;
      assigned_founder_number := nextval('public.founder_number_seq');
    end if;

    update public.licenses
    set status = 'revoked', updated_at = now()
    where user_id = local_payment.user_id
      and status = 'active'
      and plan_id <> selected_plan_id;

    insert into public.licenses (
      user_id, plan_id, status, starts_at, expires_at, lifetime,
      founder_number, source
    ) values (
      local_payment.user_id, selected_plan_id, 'active', now(), null, true,
      assigned_founder_number, 'payment:' || local_payment.id::text
    );

    update public.payments
    set fulfilled_at = now(), status = 'paid'
    where id = local_payment.id and fulfilled_at is null;
  end if;

  update public.payment_events
  set processed = true, processed_at = now()
  where id = inserted_event_id;

  select * into local_payment from public.payments where id = local_payment.id;
  return jsonb_build_object(
    'payment_id', local_payment.id,
    'status', local_payment.status,
    'fulfilled', local_payment.fulfilled_at is not null,
    'duplicate', false
  );
end;
$$;

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
    'PRO_LIFETIME',
    'FOUNDER_LIFETIME',
    'FOUNDER_UPGRADE'
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

  select *
  into before_product
  from public.products
  where code = normalized_code
  for update;

  if not found then
    raise no_data_found using message = 'Product does not exist';
  end if;

  update public.products
  set
    price_amount = p_price_amount,
    currency = normalized_currency,
    enabled = coalesce(p_enabled, false),
    updated_at = now()
  where code = normalized_code
  returning * into after_product;

  perform public.admin_write_audit(
    p_actor_user_id,
    'product.update',
    'product',
    normalized_code,
    to_jsonb(before_product),
    to_jsonb(after_product)
  );

  return jsonb_build_object(
    'before', to_jsonb(before_product),
    'after', to_jsonb(after_product)
  );
end;
$$;

revoke all on function public.has_pro_lifetime_upgrade_eligibility(uuid)
  from public, anon, authenticated;
revoke all on function public.create_pending_mercadopago_payment(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.process_mercadopago_payment(text, uuid, text, numeric, text, timestamptz, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.admin_update_product(uuid, text, numeric, text, boolean)
  from public, anon, authenticated;

grant execute on function public.has_pro_lifetime_upgrade_eligibility(uuid)
  to service_role;
grant execute on function public.create_pending_mercadopago_payment(uuid, text, text)
  to service_role;
grant execute on function public.process_mercadopago_payment(text, uuid, text, numeric, text, timestamptz, text, text, jsonb)
  to service_role;
grant execute on function public.admin_update_product(uuid, text, numeric, text, boolean)
  to service_role;

commit;
