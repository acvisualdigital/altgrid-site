begin;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  display_name text,
  referral_code text not null unique,
  referred_by uuid references public.profiles (user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length_check
    check (display_name is null or char_length(display_name) <= 100),
  constraint profiles_referral_code_format_check
    check (referral_code ~ '^HUNT-[A-HJ-NP-Z2-9]{8}$'),
  constraint profiles_referrer_not_self_check
    check (referred_by is null or referred_by <> user_id)
);

comment on column public.profiles.referred_by is
  'Supabase Auth user_id of the referring profile. public.referrals remains the canonical referral record.';

create table public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  max_accounts integer not null,
  enabled boolean not null default true,
  is_lifetime_available boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_code_format_check check (code ~ '^[A-Z][A-Z0-9_]*$'),
  constraint plans_name_not_blank_check check (btrim(name) <> ''),
  constraint plans_max_accounts_positive_check check (max_accounts > 0)
);

create table public.licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id uuid not null references public.plans (id) on delete restrict,
  status text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  lifetime boolean not null default false,
  founder_number integer unique,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint licenses_status_check
    check (status in ('active', 'expired', 'suspended', 'revoked')),
  constraint licenses_expiration_check
    check (expires_at is null or expires_at > starts_at),
  constraint licenses_lifetime_expiration_check
    check (not lifetime or expires_at is null),
  constraint licenses_founder_number_positive_check
    check (founder_number is null or founder_number > 0)
);

create table public.entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  feature_key text not null,
  feature_value jsonb,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  source_type text,
  source_id uuid,
  created_at timestamptz not null default now(),
  constraint entitlements_feature_key_not_blank_check
    check (btrim(feature_key) <> ''),
  constraint entitlements_expiration_check
    check (expires_at is null or expires_at > starts_at)
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  device_hash text not null,
  display_name text,
  platform text,
  app_version text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint devices_user_hash_unique unique (user_id, device_hash),
  constraint devices_hash_not_blank_check check (btrim(device_hash) <> ''),
  constraint devices_seen_order_check check (last_seen_at >= first_seen_at),
  constraint devices_revoked_order_check
    check (revoked_at is null or revoked_at >= first_seen_at)
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  launch_url text not null,
  developer_referral_url text,
  icon_url text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint games_slug_format_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint games_name_not_blank_check check (btrim(name) <> ''),
  constraint games_launch_url_not_blank_check check (btrim(launch_url) <> '')
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users (id) on delete restrict,
  referred_user_id uuid not null unique references auth.users (id) on delete restrict,
  status text not null,
  qualification_reason text,
  created_at timestamptz not null default now(),
  qualified_at timestamptz,
  rewarded_at timestamptz,
  constraint referrals_different_users_check
    check (referrer_user_id <> referred_user_id),
  constraint referrals_status_check
    check (status in ('pending', 'qualified', 'rewarded', 'rejected')),
  constraint referrals_qualified_order_check
    check (qualified_at is null or qualified_at >= created_at),
  constraint referrals_rewarded_order_check
    check (rewarded_at is null or rewarded_at >= coalesce(qualified_at, created_at)),
  constraint referrals_status_timestamps_check check (
    (status = 'pending' and qualified_at is null and rewarded_at is null)
    or (status = 'qualified' and qualified_at is not null and rewarded_at is null)
    or (status = 'rewarded' and qualified_at is not null and rewarded_at is not null)
    or (status = 'rejected' and rewarded_at is null)
  )
);

create table public.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals (id) on delete restrict,
  beneficiary_user_id uuid not null references auth.users (id) on delete restrict,
  reward_type text not null,
  reward_days integer not null,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint referral_rewards_type_not_blank_check check (btrim(reward_type) <> ''),
  constraint referral_rewards_days_positive_check check (reward_days > 0),
  constraint referral_rewards_once_unique
    unique (referral_id, beneficiary_user_id, reward_type)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  plan_id uuid references public.plans (id) on delete restrict,
  price_amount numeric(12, 2),
  currency text not null default 'BRL',
  lifetime boolean not null default false,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_code_format_check check (code ~ '^[A-Z][A-Z0-9_]*$'),
  constraint products_name_not_blank_check check (btrim(name) <> ''),
  constraint products_price_nonnegative_check
    check (price_amount is null or price_amount >= 0),
  constraint products_currency_format_check check (currency ~ '^[A-Z]{3}$')
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  provider text not null,
  provider_payment_id text,
  provider_external_reference text,
  product_code text not null references public.products (code) on update cascade on delete restrict,
  amount numeric(12, 2) not null,
  currency text not null default 'BRL',
  status text not null,
  raw_status text,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint payments_provider_not_blank_check check (btrim(provider) <> ''),
  constraint payments_product_code_not_blank_check check (btrim(product_code) <> ''),
  constraint payments_amount_nonnegative_check check (amount >= 0),
  constraint payments_currency_format_check check (currency ~ '^[A-Z]{3}$'),
  constraint payments_status_not_blank_check check (btrim(status) <> '')
);

create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  payment_id uuid references public.payments (id) on delete set null,
  event_type text,
  processed boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  payload_hash text,
  metadata jsonb not null default '{}'::jsonb,
  constraint payment_events_provider_event_unique unique (provider, provider_event_id),
  constraint payment_events_provider_not_blank_check check (btrim(provider) <> ''),
  constraint payment_events_event_id_not_blank_check check (btrim(provider_event_id) <> ''),
  constraint payment_events_processing_check check (
    (processed and processed_at is not null)
    or (not processed and processed_at is null)
  ),
  constraint payment_events_processed_order_check
    check (processed_at is null or processed_at >= received_at)
);

create table public.app_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  constraint app_config_key_not_blank_check check (btrim(key) <> '')
);

create index profiles_referred_by_idx on public.profiles (referred_by);
create index plans_enabled_sort_idx on public.plans (sort_order) where enabled;
create index licenses_user_id_idx on public.licenses (user_id);
create index licenses_plan_id_idx on public.licenses (plan_id);
create index licenses_user_status_expires_idx
  on public.licenses (user_id, status, expires_at);
create index entitlements_user_id_idx on public.entitlements (user_id);
create index entitlements_feature_key_idx on public.entitlements (feature_key);
create index entitlements_expires_at_idx on public.entitlements (expires_at);
create index entitlements_user_feature_idx
  on public.entitlements (user_id, feature_key);
create index games_enabled_sort_idx on public.games (sort_order) where enabled;
create index referrals_referrer_user_id_idx on public.referrals (referrer_user_id);
create index referrals_status_created_idx on public.referrals (status, created_at);
create index referral_rewards_beneficiary_idx
  on public.referral_rewards (beneficiary_user_id);
create index products_plan_id_idx on public.products (plan_id);
create index products_enabled_sort_idx on public.products (code) where enabled;
create index payments_user_id_idx on public.payments (user_id);
create index payments_product_code_idx on public.payments (product_code);
create index payments_status_created_idx on public.payments (status, created_at);
create unique index payments_provider_payment_id_unique_idx
  on public.payments (provider, provider_payment_id)
  where provider_payment_id is not null;
create index payment_events_payment_id_idx on public.payment_events (payment_id);
create index payment_events_processing_idx
  on public.payment_events (processed, received_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger plans_set_updated_at
before update on public.plans
for each row execute function public.set_updated_at();

create trigger licenses_set_updated_at
before update on public.licenses
for each row execute function public.set_updated_at();

create trigger games_set_updated_at
before update on public.games
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

create trigger app_config_set_updated_at
before update on public.app_config
for each row execute function public.set_updated_at();

create or replace function public.validate_license_founder_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_plan_code text;
begin
  if new.founder_number is null then
    return new;
  end if;

  select code
  into selected_plan_code
  from public.plans
  where id = new.plan_id;

  if selected_plan_code is distinct from 'FOUNDER' then
    raise exception using
      errcode = '23514',
      constraint = 'licenses_founder_number_plan_check',
      message = 'founder_number is only valid for the FOUNDER plan';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_license_founder_number()
  from public, anon, authenticated;

create trigger licenses_validate_founder_number
before insert or update of plan_id, founder_number on public.licenses
for each row execute function public.validate_license_founder_number();

create or replace function public.prevent_plan_code_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.code is distinct from old.code then
    raise exception using
      errcode = '23514',
      constraint = 'plans_code_immutable_check',
      message = 'plan code is immutable';
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_plan_code_change()
  from public, anon, authenticated;

create trigger plans_prevent_code_change
before update of code on public.plans
for each row execute function public.prevent_plan_code_change();

create or replace function public.generate_referral_code()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  random_bytes bytea;
  byte_index integer;
  attempt integer;
begin
  for attempt in 1..20 loop
    candidate := 'HUNT-';
    random_bytes := uuid_send(gen_random_uuid());

    for byte_index in 0..7 loop
      candidate := candidate || substr(
        alphabet,
        (get_byte(random_bytes, byte_index) % char_length(alphabet)) + 1,
        1
      );
    end loop;

    if not exists (
      select 1
      from public.profiles
      where referral_code = candidate
    ) then
      return candidate;
    end if;
  end loop;

  raise exception 'Could not generate a unique referral code';
end;
$$;

revoke all on function public.generate_referral_code()
  from public, anon, authenticated;
grant execute on function public.generate_referral_code() to service_role;

alter table public.profiles
  alter column referral_code set default public.generate_referral_code();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_display_name text;
  attempt integer;
begin
  safe_display_name := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');

  for attempt in 1..20 loop
    begin
      insert into public.profiles (user_id, display_name)
      values (new.id, left(safe_display_name, 100));

      return new;
    exception
      when unique_violation then
        if exists (
          select 1
          from public.profiles
          where user_id = new.id
        ) then
          return new;
        end if;
    end;
  end loop;

  raise exception 'Could not create profile for auth user %', new.id;
end;
$$;

revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.validate_referral_profile_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_user_id uuid;
  affected_user_ids uuid[] := array[]::uuid[];
  profile_referrer uuid;
  referral_referrer uuid;
  profile_row_exists boolean;
  referral_row_exists boolean;
begin
  if tg_table_name = 'profiles' then
    if tg_op = 'UPDATE' then
      if new.user_id is distinct from old.user_id then
        raise exception using
          errcode = '23514',
          constraint = 'profiles_user_id_immutable_check',
          message = 'profile user_id is immutable';
      end if;
    end if;
  end if;

  if tg_table_name = 'referrals' then
    if tg_op = 'INSERT' then
      affected_user_ids := array[new.referred_user_id];
    elsif tg_op = 'DELETE' then
      affected_user_ids := array[old.referred_user_id];
    elsif new.referred_user_id is distinct from old.referred_user_id then
      affected_user_ids := array[old.referred_user_id, new.referred_user_id];
    else
      affected_user_ids := array[new.referred_user_id];
    end if;
  elsif tg_op = 'DELETE' then
    affected_user_ids := array[old.user_id];
  else
    affected_user_ids := array[new.user_id];
  end if;

  foreach affected_user_id in array affected_user_ids loop
    select referred_by
    into profile_referrer
    from public.profiles
    where user_id = affected_user_id;
    profile_row_exists := found;

    select referrer_user_id
    into referral_referrer
    from public.referrals
    where referred_user_id = affected_user_id;
    referral_row_exists := found;

    if (
      referral_row_exists
      and (
        not profile_row_exists
        or profile_referrer is distinct from referral_referrer
      )
    ) or (
      not referral_row_exists
      and profile_row_exists
      and profile_referrer is not null
    ) then
      raise exception using
        errcode = '23514',
        constraint = 'profiles_referral_consistency_check',
        message = format(
          'profile and referral disagree for referred user %s',
          affected_user_id
        );
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_referral_profile_consistency()
  from public, anon, authenticated;

create constraint trigger profiles_validate_referral_consistency
after insert or update or delete on public.profiles
deferrable initially deferred
for each row execute function public.validate_referral_profile_consistency();

create constraint trigger referrals_validate_profile_consistency
after insert or update or delete on public.referrals
deferrable initially deferred
for each row execute function public.validate_referral_profile_consistency();

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.licenses enable row level security;
alter table public.entitlements enable row level security;
alter table public.devices enable row level security;
alter table public.games enable row level security;
alter table public.referrals enable row level security;
alter table public.referral_rewards enable row level security;
alter table public.products enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.app_config enable row level security;

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.plans from anon, authenticated;
revoke all on table public.licenses from anon, authenticated;
revoke all on table public.entitlements from anon, authenticated;
revoke all on table public.devices from anon, authenticated;
revoke all on table public.games from anon, authenticated;
revoke all on table public.referrals from anon, authenticated;
revoke all on table public.referral_rewards from anon, authenticated;
revoke all on table public.products from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.payment_events from anon, authenticated;
revoke all on table public.app_config from anon, authenticated;

grant select, insert, update, delete
on table
  public.profiles,
  public.plans,
  public.licenses,
  public.entitlements,
  public.devices,
  public.games,
  public.referrals,
  public.referral_rewards,
  public.products,
  public.payments,
  public.payment_events,
  public.app_config
to service_role;

grant select on table public.profiles to authenticated;
grant select on table public.licenses to authenticated;
grant select on table public.entitlements to authenticated;
grant select on table public.devices to authenticated;
grant select on table public.plans to anon, authenticated;
grant select on table public.games to anon, authenticated;
grant select on table public.products to anon, authenticated;

grant select (id, status, created_at, qualified_at, rewarded_at)
  on table public.referrals to authenticated;

grant select (
  id,
  user_id,
  provider,
  product_code,
  amount,
  currency,
  status,
  fulfilled_at,
  created_at,
  updated_at,
  paid_at
) on table public.payments to authenticated;

create policy profiles_read_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy plans_read_enabled
on public.plans
for select
to anon, authenticated
using (enabled is true);

create policy licenses_read_own
on public.licenses
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy entitlements_read_own
on public.entitlements
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy devices_read_own
on public.devices
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy games_read_enabled
on public.games
for select
to anon, authenticated
using (enabled is true);

create policy referrals_read_participant
on public.referrals
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (
    (select auth.uid()) = referrer_user_id
    or (select auth.uid()) = referred_user_id
  )
);

create policy products_read_enabled
on public.products
for select
to anon, authenticated
using (enabled is true);

create policy payments_read_own
on public.payments
for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

commit;
