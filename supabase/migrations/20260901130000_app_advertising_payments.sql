begin;

alter table public.app_ad_requests
  drop constraint if exists app_ad_requests_status_check;
alter table public.app_ad_requests
  add constraint app_ad_requests_status_check check (
    status in ('pending', 'reviewing', 'payment_pending', 'approved', 'rejected', 'cancelled')
  );

alter table public.app_ad_requests
  drop constraint if exists app_ad_requests_schedule_check;
alter table public.app_ad_requests
  add constraint app_ad_requests_schedule_check check (
    (status = 'approved' and starts_at is not null and ends_at > starts_at)
    or (status <> 'approved' and starts_at is null and ends_at is null)
  );

create table public.app_ad_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.app_ad_requests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete restrict,
  provider text not null default 'mercadopago',
  provider_payment_id text unique,
  amount numeric(10, 2) not null,
  currency text not null,
  status text not null default 'payment_pending',
  raw_status text,
  paid_at timestamptz,
  fulfilled_at timestamptz,
  provider_expires_at timestamptz,
  failure_reason text,
  checkout_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_ad_payments_amount_check check (amount > 0),
  constraint app_ad_payments_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint app_ad_payments_provider_check check (provider = 'mercadopago')
);

create trigger app_ad_payments_set_updated_at
before update on public.app_ad_payments
for each row execute function public.set_updated_at();

create table public.app_ad_payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.app_ad_payments (id) on delete cascade,
  provider_event_id text not null unique,
  payload_hash text not null,
  provider_data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.app_ad_payments enable row level security;
alter table public.app_ad_payment_events enable row level security;
revoke all on table public.app_ad_payments, public.app_ad_payment_events from anon, authenticated;
grant select, insert, update, delete on table public.app_ad_payments, public.app_ad_payment_events to service_role;

create or replace function public.app_ad_payment_json(payment public.app_ad_payments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', payment.id,
    'user_id', payment.user_id,
    'provider', payment.provider,
    'provider_payment_id', payment.provider_payment_id,
    'provider_external_reference', payment.request_id::text,
    'product_code', 'APP_ADVERTISING',
    'amount', payment.amount,
    'currency', payment.currency,
    'status', payment.status,
    'raw_status', payment.raw_status,
    'fulfilled_at', payment.fulfilled_at,
    'paid_at', payment.paid_at,
    'provider_expires_at', payment.provider_expires_at,
    'failure_reason', payment.failure_reason,
    'metadata', payment.metadata || jsonb_build_object(
      'request_id', payment.request_id,
      'checkout', coalesce(payment.checkout_data, '{}'::jsonb)
    ),
    'created_at', payment.created_at,
    'updated_at', payment.updated_at
  );
$$;

create or replace function public.list_user_app_ad_requests(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id,
    'status', request.status,
    'plan_code', request.plan_code,
    'requested_days', request.requested_days,
    'quoted_amount', request.quoted_amount,
    'currency', request.currency,
    'created_at', request.created_at,
    'advertiser_name', request.advertiser_name,
    'title', request.title,
    'admin_notes', request.admin_notes,
    'starts_at', request.starts_at,
    'ends_at', request.ends_at,
    'payment', case when payment.id is null then null else public.app_ad_payment_json(payment) end
  ) order by request.created_at desc), '[]'::jsonb)
  from public.app_ad_requests as request
  left join public.app_ad_payments as payment on payment.request_id = request.id
  where request.user_id = p_user_id;
$$;

create or replace function public.get_app_ad_payment(p_request_id uuid, p_user_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_ad_payment_json(payment)
  from public.app_ad_payments as payment
  where payment.request_id = p_request_id
    and (p_user_id is null or payment.user_id = p_user_id);
$$;

create or replace function public.attach_app_ad_payment(
  p_user_id uuid,
  p_request_id uuid,
  p_provider_payment_id text,
  p_status text,
  p_expires_at timestamptz,
  p_checkout_data jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  payment public.app_ad_payments%rowtype;
begin
  update public.app_ad_payments set
    provider_payment_id = p_provider_payment_id,
    status = p_status,
    raw_status = p_status,
    provider_expires_at = p_expires_at,
    checkout_data = p_checkout_data,
    failure_reason = null
  where request_id = p_request_id and user_id = p_user_id and status = 'payment_pending'
  returning * into payment;
  if payment.id is null then
    select * into payment from public.app_ad_payments
    where request_id = p_request_id and user_id = p_user_id;
  end if;
  if payment.id is null then raise exception 'advertising payment unavailable' using errcode = 'P0002'; end if;
  return public.app_ad_payment_json(payment);
end;
$$;

create or replace function public.fail_pending_app_ad_payment(
  p_user_id uuid,
  p_request_id uuid,
  p_reason text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.app_ad_payments set failure_reason = left(p_reason, 500)
  where request_id = p_request_id and user_id = p_user_id and provider_payment_id is null;
$$;

create or replace function public.list_pending_app_ad_payments(p_limit integer default 25)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.app_ad_payment_json(payment)
  from public.app_ad_payments as payment
  where payment.status in ('pending', 'in_process')
    and payment.provider_payment_id is not null
    and payment.created_at >= now() - interval '48 hours'
  order by payment.updated_at asc
  limit greatest(1, least(p_limit, 100));
$$;

create or replace function public.process_app_ad_payment(
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
volatile
security definer
set search_path = ''
as $$
declare
  payment public.app_ad_payments%rowtype;
  request public.app_ad_requests%rowtype;
  duplicate_event boolean := false;
  activated boolean := false;
  inserted_event_id uuid;
begin
  select * into payment from public.app_ad_payments
  where request_id = p_external_reference and provider = 'mercadopago'
  for update;
  if payment.id is null then raise exception 'advertising payment not found' using errcode = 'P0002'; end if;
  if payment.provider_payment_id is distinct from p_provider_payment_id
    or payment.amount <> p_amount or payment.currency <> p_currency then
    raise exception 'advertising payment mismatch' using errcode = '22023';
  end if;

  insert into public.app_ad_payment_events (payment_id, provider_event_id, payload_hash, provider_data)
  values (payment.id, p_event_id, p_payload_hash, p_provider_data)
  on conflict (provider_event_id) do nothing
  returning id into inserted_event_id;
  duplicate_event := inserted_event_id is null;

  update public.app_ad_payments set
    status = p_provider_status,
    raw_status = p_provider_status,
    paid_at = case when p_provider_status = 'approved' then coalesce(p_paid_at, now()) else paid_at end,
    fulfilled_at = case when p_provider_status = 'approved' then coalesce(fulfilled_at, now()) else fulfilled_at end,
    metadata = metadata || jsonb_build_object('provider_status', p_provider_status)
  where id = payment.id returning * into payment;

  if p_provider_status = 'approved' then
    update public.app_ad_requests set
      status = 'approved',
      starts_at = coalesce(starts_at, now()),
      ends_at = coalesce(ends_at, now() + make_interval(days => requested_days))
    where id = payment.request_id and status = 'payment_pending'
    returning * into request;
    activated := request.id is not null;
  end if;

  return jsonb_build_object(
    'payment_id', payment.request_id,
    'status', payment.status,
    'fulfilled', payment.fulfilled_at is not null,
    'duplicate', duplicate_event,
    'campaign_activated', activated
  );
end;
$$;

drop function if exists public.admin_review_app_ad_request(uuid, uuid, text, text);
create function public.admin_review_app_ad_request(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  before_row public.app_ad_requests%rowtype;
  after_row public.app_ad_requests%rowtype;
begin
  perform public.admin_assert_actor(p_actor_user_id);
  if p_status not in ('reviewing', 'payment_pending', 'rejected') then
    raise exception 'invalid advertising review status' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 2000 then
    raise exception 'advertising review notes too long' using errcode = '22023';
  end if;

  select * into before_row from public.app_ad_requests where id = p_request_id for update;
  if before_row.id is null then raise exception 'advertising request not found' using errcode = 'P0002'; end if;
  if before_row.status = 'approved' then raise exception 'paid advertising request is immutable' using errcode = '22023'; end if;

  update public.app_ad_requests set
    status = p_status,
    admin_notes = nullif(btrim(coalesce(p_notes, '')), ''),
    reviewed_by = p_actor_user_id,
    reviewed_at = now(),
    starts_at = null,
    ends_at = null
  where id = p_request_id returning * into after_row;

  if p_status = 'payment_pending' then
    insert into public.app_ad_payments (
      request_id, user_id, amount, currency, status, metadata
    ) values (
      after_row.id, after_row.user_id, after_row.quoted_amount, after_row.currency,
      'payment_pending', jsonb_build_object('title', after_row.title, 'plan_code', after_row.plan_code)
    ) on conflict (request_id) do update set
      amount = excluded.amount,
      currency = excluded.currency,
      status = case when public.app_ad_payments.provider_payment_id is null then 'payment_pending' else public.app_ad_payments.status end,
      metadata = excluded.metadata;
  end if;

  perform public.admin_write_audit(
    p_actor_user_id, 'app.advertising.' || p_status, 'app_ad_request',
    p_request_id::text, to_jsonb(before_row), to_jsonb(after_row)
  );
  return to_jsonb(after_row);
end;
$$;

drop function if exists public.admin_list_app_ad_requests(uuid, text);
create function public.admin_list_app_ad_requests(p_actor_user_id uuid, p_status text default null)
returns table (
  id uuid, user_id uuid, user_email text, display_name text,
  plan_code text, plan_name text, category text, game_slug text,
  catalog_game_name text, catalog_launch_url text, catalog_icon_url text,
  advertiser_name text, title text, description text, destination_url text,
  image_url text, cta_label text, requested_days integer, quoted_amount numeric,
  currency text, status text, admin_notes text, reviewed_by uuid,
  reviewed_at timestamptz, starts_at timestamptz, ends_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_assert_actor(p_actor_user_id);
  if p_status is not null and p_status not in ('pending', 'reviewing', 'payment_pending', 'approved', 'rejected', 'cancelled') then
    raise exception 'invalid advertising status' using errcode = '22023';
  end if;
  return query
  select request.id, request.user_id, account.email::text, profile.display_name,
    request.plan_code, plan.name, request.category, request.game_slug,
    request.catalog_game_name, request.catalog_launch_url, request.catalog_icon_url,
    request.advertiser_name, request.title, request.description,
    request.destination_url, request.image_url, request.cta_label,
    request.requested_days, request.quoted_amount, request.currency, request.status,
    request.admin_notes, request.reviewed_by, request.reviewed_at,
    request.starts_at, request.ends_at, request.created_at, request.updated_at
  from public.app_ad_requests as request
  join public.app_ad_plans as plan on plan.code = request.plan_code
  left join auth.users as account on account.id = request.user_id
  left join public.profiles as profile on profile.user_id = request.user_id
  where p_status is null or request.status = p_status
  order by case request.status
    when 'pending' then 0 when 'reviewing' then 1 when 'payment_pending' then 2 else 3 end,
    request.created_at desc
  limit 250;
end;
$$;

revoke all on function public.app_ad_payment_json(public.app_ad_payments) from public, anon, authenticated;
revoke all on function public.list_user_app_ad_requests(uuid) from public, anon, authenticated;
revoke all on function public.get_app_ad_payment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.attach_app_ad_payment(uuid, uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.fail_pending_app_ad_payment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.list_pending_app_ad_payments(integer) from public, anon, authenticated;
revoke all on function public.process_app_ad_payment(text, uuid, text, numeric, text, timestamptz, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_review_app_ad_request(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_list_app_ad_requests(uuid, text) from public, anon, authenticated;

grant execute on function public.list_user_app_ad_requests(uuid) to service_role;
grant execute on function public.get_app_ad_payment(uuid, uuid) to service_role;
grant execute on function public.attach_app_ad_payment(uuid, uuid, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.fail_pending_app_ad_payment(uuid, uuid, text) to service_role;
grant execute on function public.list_pending_app_ad_payments(integer) to service_role;
grant execute on function public.process_app_ad_payment(text, uuid, text, numeric, text, timestamptz, text, text, jsonb) to service_role;
grant execute on function public.admin_review_app_ad_request(uuid, uuid, text, text) to service_role;
grant execute on function public.admin_list_app_ad_requests(uuid, text) to service_role;

commit;
