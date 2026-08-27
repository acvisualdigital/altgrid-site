begin;

-- Public runtime configuration. Referral keys from previous migrations are
-- intentionally left untouched as inert legacy data.
insert into public.app_config (key, value, is_public)
values
  ('maintenance', 'false'::jsonb, true),
  ('minimum_version', '"2.0.0"'::jsonb, true),
  ('latest_version', '"2.0.0"'::jsonb, true),
  ('update_channel', '"stable"'::jsonb, true),
  ('founder_max_sales', 'null'::jsonb, false)
on conflict (key) do update
set is_public = excluded.is_public;

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  type text not null default 'info',
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_check
    check (btrim(title) <> '' and char_length(title) <= 160),
  constraint announcements_message_check
    check (btrim(message) <> '' and char_length(message) <= 4000),
  constraint announcements_type_check
    check (type in ('info', 'warning', 'maintenance')),
  constraint announcements_expiration_check
    check (expires_at is null or expires_at > published_at)
);

create index announcements_public_idx
  on public.announcements (published_at desc, id desc)
  where enabled;

create trigger announcements_set_updated_at
before update on public.announcements
for each row execute function public.set_updated_at();

create table public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  game_id uuid references public.games (id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint chat_channels_type_check check (type in ('global', 'game')),
  constraint chat_channels_game_check check (
    (type = 'global' and game_id is null)
    or (type = 'game' and game_id is not null)
  ),
  constraint chat_channels_name_check
    check (btrim(name) <> '' and char_length(name) <= 120)
);

create unique index chat_channels_single_global_idx
  on public.chat_channels (type)
  where type = 'global';
create unique index chat_channels_game_unique_idx
  on public.chat_channels (game_id)
  where game_id is not null;
create index chat_channels_enabled_idx
  on public.chat_channels (enabled, type, name);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.chat_channels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint chat_messages_message_check check (
    btrim(message) <> ''
    and char_length(message) <= 500
    and message !~ '[[:cntrl:]]'
  ),
  constraint chat_messages_edited_order_check
    check (edited_at is null or edited_at >= created_at),
  constraint chat_messages_deleted_order_check
    check (deleted_at is null or deleted_at >= created_at)
);

create index chat_messages_channel_created_idx
  on public.chat_messages (channel_id, created_at desc, id desc)
  where deleted_at is null;
create index chat_messages_user_created_idx
  on public.chat_messages (user_id, created_at desc);

create table public.chat_mutes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'mute',
  reason text not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users (id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete restrict,
  constraint chat_mutes_kind_check check (kind in ('mute', 'ban')),
  constraint chat_mutes_reason_check
    check (btrim(reason) <> '' and char_length(reason) <= 500),
  constraint chat_mutes_kind_expiration_check check (
    (kind = 'ban' and expires_at is null)
    or (kind = 'mute' and expires_at is not null and expires_at > created_at)
  ),
  constraint chat_mutes_revoked_order_check
    check (revoked_at is null or revoked_at >= created_at)
);

create unique index chat_mutes_one_current_idx
  on public.chat_mutes (user_id)
  where revoked_at is null;
create index chat_mutes_user_status_idx
  on public.chat_mutes (user_id, revoked_at, expires_at desc);

create table public.chat_reports (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  reported_by uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  constraint chat_reports_once_unique unique (message_id, reported_by),
  constraint chat_reports_reason_check
    check (btrim(reason) <> '' and char_length(reason) <= 500),
  constraint chat_reports_status_check
    check (status in ('pending', 'reviewed', 'dismissed', 'actioned')),
  constraint chat_reports_review_check check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status <> 'pending' and reviewed_at is not null and reviewed_by is not null)
  )
);

create index chat_reports_status_created_idx
  on public.chat_reports (status, created_at desc);

insert into public.chat_channels (type, game_id, name, enabled)
values ('global', null, 'Global', true)
on conflict do nothing;

insert into public.chat_channels (type, game_id, name, enabled)
select 'game', id, name, enabled
from public.games
on conflict (game_id) where game_id is not null do update
set name = excluded.name, enabled = excluded.enabled;

create or replace function public.sync_game_chat_channel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.chat_channels (type, game_id, name, enabled)
  values ('game', new.id, new.name, new.enabled)
  on conflict (game_id) where game_id is not null do update
  set name = excluded.name, enabled = excluded.enabled;
  return new;
end;
$$;

revoke all on function public.sync_game_chat_channel()
  from public, anon, authenticated;

create trigger games_sync_chat_channel
after insert or update of name, enabled on public.games
for each row execute function public.sync_game_chat_channel();

alter table public.announcements enable row level security;
alter table public.chat_channels enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_mutes enable row level security;
alter table public.chat_reports enable row level security;

revoke all on table public.announcements from public, anon, authenticated;
revoke all on table public.chat_channels from public, anon, authenticated;
revoke all on table public.chat_messages from public, anon, authenticated;
revoke all on table public.chat_mutes from public, anon, authenticated;
revoke all on table public.chat_reports from public, anon, authenticated;

grant select, insert, update, delete on table public.announcements to service_role;
grant select, insert, update, delete on table public.chat_channels to service_role;
grant select, insert, update, delete on table public.chat_messages to service_role;
grant select, insert, update, delete on table public.chat_mutes to service_role;
grant select, insert, update, delete on table public.chat_reports to service_role;

-- Authenticated clients may subscribe to safe chat rows through Realtime, but
-- all writes remain Worker-only so user_id can never be mass-assigned.
grant select on table public.chat_channels to authenticated;
grant select (id, channel_id, user_id, message, created_at, edited_at)
  on table public.chat_messages to authenticated;

create policy chat_channels_authenticated_read
on public.chat_channels
for select
to authenticated
using (enabled);

create policy chat_messages_authenticated_read
on public.chat_messages
for select
to authenticated
using (
  deleted_at is null
  and exists (
    select 1 from public.chat_channels
    where chat_channels.id = chat_messages.channel_id
      and chat_channels.enabled
  )
);

-- Supabase Realtime uses the table publication; RLS still controls subscribers.
alter publication supabase_realtime add table public.chat_messages;

create or replace function public.chat_status(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_build_object(
      'banned', m.kind = 'ban',
      'muted_until', case when m.kind = 'mute' then m.expires_at else null end,
      'reason', m.reason
    )
    from public.chat_mutes m
    where m.user_id = p_user_id
      and m.revoked_at is null
      and (m.kind = 'ban' or m.expires_at > now())
    order by m.created_at desc
    limit 1
  ), jsonb_build_object('banned', false, 'muted_until', null, 'reason', null));
$$;

create or replace function public.chat_list_messages(
  p_user_id uuid,
  p_channel_id uuid,
  p_before timestamptz default null,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = '22023', message = 'invalid page size';
  end if;

  if not exists (
    select 1 from public.chat_channels c
    where c.id = p_channel_id and c.enabled
  ) then
    raise exception using errcode = 'P0002', message = 'chat channel not found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at, rows.id), '[]'::jsonb)
  into result
  from (
    select
      m.id,
      m.channel_id,
      m.user_id,
      coalesce(nullif(btrim(p.display_name), ''), 'Usuário') as display_name,
      m.message,
      m.created_at,
      m.edited_at,
      coalesce(access.plan_code, 'FREE') as plan,
      access.founder_number
    from public.chat_messages m
    left join public.profiles p on p.user_id = m.user_id
    left join lateral (
      select pl.code as plan_code, l.founder_number
      from public.licenses l
      join public.plans pl on pl.id = l.plan_id
      where l.user_id = m.user_id
        and l.status = 'active'
        and l.starts_at <= now()
        and (l.lifetime or l.expires_at > now())
        and pl.enabled
      order by pl.entitlement_rank desc, l.created_at desc, l.id desc
      limit 1
    ) access on true
    where m.channel_id = p_channel_id
      and m.deleted_at is null
      and (p_before is null or m.created_at < p_before)
    order by m.created_at desc, m.id desc
    limit p_page_size + 1
  ) rows;

  return result;
end;
$$;

create or replace function public.chat_send_message(
  p_user_id uuid,
  p_channel_id uuid,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_message text := btrim(p_message);
  inserted public.chat_messages;
  active_restriction public.chat_mutes;
  response jsonb;
begin
  if normalized_message = '' or char_length(normalized_message) > 500 then
    raise exception using errcode = '22023', message = 'invalid chat message';
  end if;

  if normalized_message ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'invalid chat message';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = '23503', message = 'user not found';
  end if;

  if not exists (
    select 1 from public.chat_channels
    where id = p_channel_id and enabled
  ) then
    raise exception using errcode = 'P0002', message = 'chat channel not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('altgrid:chat:' || p_user_id::text, 0));

  select * into active_restriction
  from public.chat_mutes
  where user_id = p_user_id
    and revoked_at is null
    and (kind = 'ban' or expires_at > now())
  order by created_at desc
  limit 1;

  if found then
    raise exception using
      errcode = '42501',
      message = case when active_restriction.kind = 'ban'
        then 'chat banned' else 'chat muted' end;
  end if;

  if (
    select count(*) from public.chat_messages
    where user_id = p_user_id and created_at > now() - interval '10 seconds'
  ) >= 5 or (
    select count(*) from public.chat_messages
    where user_id = p_user_id and created_at > now() - interval '1 minute'
  ) >= 20 then
    raise exception using errcode = 'P0001', message = 'chat rate limit';
  end if;

  insert into public.chat_messages (channel_id, user_id, message)
  values (p_channel_id, p_user_id, normalized_message)
  returning * into inserted;

  select jsonb_build_object(
    'id', inserted.id,
    'channel_id', inserted.channel_id,
    'user_id', inserted.user_id,
    'display_name', coalesce(nullif(btrim(p.display_name), ''), 'Usuário'),
    'message', inserted.message,
    'created_at', inserted.created_at,
    'edited_at', inserted.edited_at,
    'plan', coalesce(access.plan_code, 'FREE'),
    'founder_number', access.founder_number
  ) into response
  from (select 1) singleton
  left join public.profiles p on p.user_id = inserted.user_id
  left join lateral (
    select pl.code as plan_code, l.founder_number
    from public.licenses l
    join public.plans pl on pl.id = l.plan_id
    where l.user_id = inserted.user_id
      and l.status = 'active'
      and l.starts_at <= now()
      and (l.lifetime or l.expires_at > now())
      and pl.enabled
    order by pl.entitlement_rank desc, l.created_at desc, l.id desc
    limit 1
  ) access on true;

  return response;
end;
$$;

create or replace function public.chat_report_message(
  p_user_id uuid,
  p_message_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted public.chat_reports;
begin
  if btrim(p_reason) = '' or char_length(btrim(p_reason)) > 500 then
    raise exception using errcode = '22023', message = 'invalid report reason';
  end if;

  if not exists (
    select 1 from public.chat_messages
    where id = p_message_id and deleted_at is null
  ) then
    raise exception using errcode = 'P0002', message = 'chat message not found';
  end if;

  insert into public.chat_reports (message_id, reported_by, reason)
  values (p_message_id, p_user_id, btrim(p_reason))
  on conflict (message_id, reported_by) do update
  set reason = excluded.reason
  returning * into inserted;

  return jsonb_build_object('id', inserted.id, 'status', inserted.status);
end;
$$;

revoke all on function public.chat_status(uuid) from public, anon, authenticated;
revoke all on function public.chat_list_messages(uuid, uuid, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.chat_send_message(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.chat_report_message(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.chat_status(uuid) to service_role;
grant execute on function public.chat_list_messages(uuid, uuid, timestamptz, integer)
  to service_role;
grant execute on function public.chat_send_message(uuid, uuid, text) to service_role;
grant execute on function public.chat_report_message(uuid, uuid, text) to service_role;

-- Payment records remain private and are mutated only through the Worker/RPCs.
alter table public.payments
  add column request_key text,
  add column provider_expires_at timestamptz,
  add column failure_reason text;

create unique index payments_user_request_key_unique_idx
  on public.payments (user_id, provider, request_key)
  where request_key is not null;
create index payments_provider_reference_idx
  on public.payments (provider, provider_external_reference)
  where provider_external_reference is not null;

create sequence public.founder_number_seq as integer minvalue 1;

select setval(
  'public.founder_number_seq',
  greatest(coalesce((select max(founder_number) from public.licenses), 0), 1),
  (select max(founder_number) is not null from public.licenses)
);

revoke all on sequence public.founder_number_seq from public, anon, authenticated;
grant usage, select on sequence public.founder_number_seq to service_role;

create or replace function public.founder_sales_limit()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  raw_value jsonb;
  parsed integer;
begin
  select value into raw_value from public.app_config where key = 'founder_max_sales';
  if raw_value is null or jsonb_typeof(raw_value) = 'null' then
    return null;
  end if;
  begin
    parsed := (raw_value #>> '{}')::integer;
  exception when others then
    raise exception using errcode = '22023', message = 'invalid founder_max_sales';
  end;
  if parsed < 1 then
    raise exception using errcode = '22023', message = 'invalid founder_max_sales';
  end if;
  return parsed;
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

  -- Serialize retries for the same user-supplied idempotency key. This check
  -- must happen before Founder availability accounting so a safe retry keeps
  -- returning its original reservation even when the sale limit is now full.
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
    sales_limit := public.founder_sales_limit();
    if sales_limit is not null then
      select count(*) into reserved_sales
      from public.payments
      where product_code = 'FOUNDER_LIFETIME'
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

create or replace function public.attach_mercadopago_payment(
  p_user_id uuid,
  p_payment_id uuid,
  p_provider_payment_id text,
  p_status text,
  p_expires_at timestamptz,
  p_checkout_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated public.payments;
begin
  update public.payments
  set
    provider_payment_id = p_provider_payment_id,
    status = case when p_status in ('pending', 'in_process') then p_status else 'pending' end,
    raw_status = p_status,
    provider_expires_at = p_expires_at,
    metadata = metadata || jsonb_build_object('checkout', p_checkout_data)
  where id = p_payment_id
    and user_id = p_user_id
    and provider = 'mercadopago'
    and (provider_payment_id is null or provider_payment_id = p_provider_payment_id)
    and fulfilled_at is null
  returning * into updated;

  if not found then
    raise exception using errcode = 'P0002', message = 'payment not found';
  end if;
  return to_jsonb(updated);
end;
$$;

create or replace function public.fail_pending_payment(
  p_user_id uuid,
  p_payment_id uuid,
  p_reason text
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payments
  set status = 'failed', failure_reason = left(p_reason, 200)
  where id = p_payment_id
    and user_id = p_user_id
    and status = 'pending'
    and provider_payment_id is null;
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
      sales_limit := public.founder_sales_limit();
      if sales_limit is not null then
        select count(*) into completed_sales
        from public.payments
        where product_code = 'FOUNDER_LIFETIME'
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

revoke all on function public.founder_sales_limit() from public, anon, authenticated;
revoke all on function public.create_pending_mercadopago_payment(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.attach_mercadopago_payment(uuid, uuid, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_pending_payment(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.process_mercadopago_payment(text, uuid, text, numeric, text, timestamptz, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.founder_sales_limit() to service_role;
grant execute on function public.create_pending_mercadopago_payment(uuid, text, text)
  to service_role;
grant execute on function public.attach_mercadopago_payment(uuid, uuid, text, text, timestamptz, jsonb)
  to service_role;
grant execute on function public.fail_pending_payment(uuid, uuid, text) to service_role;
grant execute on function public.process_mercadopago_payment(text, uuid, text, numeric, text, timestamptz, text, text, jsonb)
  to service_role;

create or replace function public.admin_upsert_announcement(
  p_actor_user_id uuid,
  p_id uuid,
  p_title text,
  p_message text,
  p_type text,
  p_published_at timestamptz,
  p_expires_at timestamptz,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.announcements;
  after_row public.announcements;
begin
  perform public.admin_assert_actor(p_actor_user_id);
  if p_id is null then
    insert into public.announcements (
      title, message, type, published_at, expires_at, enabled
    ) values (
      p_title, p_message, p_type, p_published_at, p_expires_at, p_enabled
    ) returning * into after_row;
  else
    select * into before_row from public.announcements where id = p_id for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'announcement not found';
    end if;
    update public.announcements
    set title = p_title, message = p_message, type = p_type,
      published_at = p_published_at, expires_at = p_expires_at,
      enabled = p_enabled
    where id = p_id
    returning * into after_row;
  end if;
  perform public.admin_write_audit(
    p_actor_user_id,
    case when p_id is null then 'announcement.create' else 'announcement.update' end,
    'announcement', after_row.id::text, to_jsonb(before_row), to_jsonb(after_row)
  );
  return jsonb_build_object('after', to_jsonb(after_row));
end;
$$;

create or replace function public.admin_delete_announcement(
  p_actor_user_id uuid,
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.announcements;
begin
  perform public.admin_assert_actor(p_actor_user_id);
  select * into before_row from public.announcements where id = p_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'announcement not found';
  end if;
  delete from public.announcements where id = p_id;
  perform public.admin_write_audit(
    p_actor_user_id, 'announcement.delete', 'announcement', p_id::text,
    to_jsonb(before_row), null
  );
end;
$$;

create or replace function public.admin_set_chat_restriction(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_kind text,
  p_reason text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_rows jsonb;
  after_row public.chat_mutes;
begin
  perform public.admin_assert_actor(p_actor_user_id);
  if p_kind not in ('mute', 'ban')
    or (p_kind = 'mute' and (p_expires_at is null or p_expires_at <= now()))
    or (p_kind = 'ban' and p_expires_at is not null) then
    raise exception using errcode = '22023', message = 'invalid chat restriction';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'altgrid:chat-moderation:' || p_target_user_id::text, 0
  ));
  select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into before_rows
  from public.chat_mutes m
  where m.user_id = p_target_user_id and m.revoked_at is null;
  update public.chat_mutes
  set revoked_at = now(), revoked_by = p_actor_user_id
  where user_id = p_target_user_id and revoked_at is null;
  insert into public.chat_mutes (
    user_id, kind, reason, expires_at, created_by
  ) values (
    p_target_user_id, p_kind, btrim(p_reason), p_expires_at, p_actor_user_id
  ) returning * into after_row;
  perform public.admin_write_audit(
    p_actor_user_id, 'chat.' || p_kind, 'user', p_target_user_id::text,
    before_rows, to_jsonb(after_row)
  );
  return jsonb_build_object('after', to_jsonb(after_row));
end;
$$;

create or replace function public.admin_clear_chat_restriction(
  p_actor_user_id uuid,
  p_target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_rows jsonb;
begin
  perform public.admin_assert_actor(p_actor_user_id);
  select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into before_rows
  from public.chat_mutes m
  where m.user_id = p_target_user_id and m.revoked_at is null;
  update public.chat_mutes
  set revoked_at = now(), revoked_by = p_actor_user_id
  where user_id = p_target_user_id and revoked_at is null;
  perform public.admin_write_audit(
    p_actor_user_id, 'chat.restriction.clear', 'user', p_target_user_id::text,
    before_rows, jsonb_build_object('cleared', true)
  );
end;
$$;

create or replace function public.admin_delete_chat_message(
  p_actor_user_id uuid,
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.chat_messages;
  after_row public.chat_messages;
begin
  perform public.admin_assert_actor(p_actor_user_id);
  select * into before_row from public.chat_messages where id = p_message_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'chat message not found';
  end if;
  update public.chat_messages set deleted_at = coalesce(deleted_at, now())
  where id = p_message_id returning * into after_row;
  perform public.admin_write_audit(
    p_actor_user_id, 'chat.message.delete', 'chat_message', p_message_id::text,
    to_jsonb(before_row), to_jsonb(after_row)
  );
end;
$$;

create or replace function public.admin_list_chat_reports(
  p_actor_user_id uuid,
  p_status text default null,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  if p_status is not null
    and p_status not in ('pending', 'reviewed', 'dismissed', 'actioned') then
    raise exception using errcode = '22023', message = 'invalid report status';
  end if;

  if p_page_size < 1 or p_page_size > 200 then
    raise exception using errcode = '22023', message = 'invalid page size';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(report_row) order by report_row.created_at desc, report_row.id desc),
    '[]'::jsonb
  )
  into result
  from (
    select
      report.id,
      report.message_id,
      report.reported_by,
      coalesce(nullif(btrim(reporter.display_name), ''), 'Usuário')
        as reporter_display_name,
      report.reason,
      report.status,
      report.created_at,
      report.reviewed_at,
      report.reviewed_by,
      message.channel_id,
      channel.type as channel_type,
      channel.game_id,
      channel.name as channel_name,
      message.user_id as message_user_id,
      coalesce(nullif(btrim(author.display_name), ''), 'Usuário')
        as message_user_display_name,
      message.message,
      message.created_at as message_created_at,
      message.deleted_at as message_deleted_at
    from public.chat_reports report
    join public.chat_messages message on message.id = report.message_id
    join public.chat_channels channel on channel.id = message.channel_id
    left join public.profiles reporter on reporter.user_id = report.reported_by
    left join public.profiles author on author.user_id = message.user_id
    where p_status is null or report.status = p_status
    order by report.created_at desc, report.id desc
    limit p_page_size
  ) report_row;

  return result;
end;
$$;

create or replace function public.admin_review_chat_report(
  p_actor_user_id uuid,
  p_report_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_row public.chat_reports;
  after_row public.chat_reports;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  if p_status is null
    or p_status not in ('reviewed', 'dismissed', 'actioned') then
    raise exception using errcode = '22023', message = 'invalid report status';
  end if;

  select * into before_row
  from public.chat_reports
  where id = p_report_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'chat report not found';
  end if;

  update public.chat_reports
  set
    status = p_status,
    reviewed_at = now(),
    reviewed_by = p_actor_user_id
  where id = p_report_id
  returning * into after_row;

  perform public.admin_write_audit(
    p_actor_user_id,
    'chat.report.' || p_status,
    'chat_report',
    p_report_id::text,
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return jsonb_build_object('after', to_jsonb(after_row));
end;
$$;

revoke all on function public.admin_upsert_announcement(uuid, uuid, text, text, text, timestamptz, timestamptz, boolean)
  from public, anon, authenticated;
revoke all on function public.admin_delete_announcement(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_set_chat_restriction(uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.admin_clear_chat_restriction(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_delete_chat_message(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.admin_list_chat_reports(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.admin_review_chat_report(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_upsert_announcement(uuid, uuid, text, text, text, timestamptz, timestamptz, boolean)
  to service_role;
grant execute on function public.admin_delete_announcement(uuid, uuid) to service_role;
grant execute on function public.admin_set_chat_restriction(uuid, uuid, text, text, timestamptz)
  to service_role;
grant execute on function public.admin_clear_chat_restriction(uuid, uuid) to service_role;
grant execute on function public.admin_delete_chat_message(uuid, uuid) to service_role;
grant execute on function public.admin_list_chat_reports(uuid, text, integer)
  to service_role;
grant execute on function public.admin_review_chat_report(uuid, uuid, text)
  to service_role;

commit;
