begin;

create table public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'admin',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint admin_users_role_check check (role = 'admin')
);

comment on table public.admin_users is
  'Server-managed administrator allowlist. Never derive this role from profiles or user-editable Auth metadata.';

-- Bootstrap the first administrator out-of-band with the SQL Dashboard or
-- another service-role-only process. The application intentionally exposes no
-- endpoint that can promote a regular user.

create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users (id) on delete restrict,
  action text not null,
  target_type text not null,
  target_id text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now(),
  constraint admin_audit_logs_action_not_blank_check check (btrim(action) <> ''),
  constraint admin_audit_logs_target_type_not_blank_check check (btrim(target_type) <> '')
);

comment on table public.admin_audit_logs is
  'Append-only audit trail written atomically by server-only administrative RPCs.';

create index admin_users_enabled_idx
  on public.admin_users (enabled, user_id)
  where enabled;

create index admin_audit_logs_actor_created_idx
  on public.admin_audit_logs (actor_user_id, created_at desc);

create index admin_audit_logs_target_created_idx
  on public.admin_audit_logs (target_type, target_id, created_at desc);

alter table public.admin_users enable row level security;
alter table public.admin_audit_logs enable row level security;

revoke all on table public.admin_users from public, anon, authenticated;
revoke all on table public.admin_audit_logs from public, anon, authenticated;

grant select, insert, update, delete on table public.admin_users to service_role;
grant select on table public.admin_audit_logs to service_role;

insert into public.app_config (key, value)
values
  ('referral_referrer_days', '1'::jsonb),
  ('referral_referred_days', '1'::jsonb),
  ('founder_max_sales', 'null'::jsonb)
on conflict (key) do nothing;

insert into public.products (
  code,
  name,
  description,
  plan_id,
  price_amount,
  currency,
  lifetime,
  enabled,
  metadata
)
select
  seed.code,
  seed.name,
  seed.description,
  plan.id,
  null,
  'BRL',
  true,
  false,
  '{}'::jsonb
from (
  values
    ('PRO_LIFETIME', 'PRO Lifetime', 'Acesso vitalício ao plano PRO.', 'PRO'),
    ('FOUNDER_LIFETIME', 'Founder Lifetime', 'Acesso vitalício ao plano Founder.', 'FOUNDER')
) as seed(code, name, description, plan_code)
join public.plans as plan on plan.code = seed.plan_code
on conflict (code) do nothing;

create or replace function public.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.admin_users
      where user_id = (select auth.uid())
        and role = 'admin'
        and enabled
    );
$$;

revoke all on function public.is_current_user_admin()
  from public, anon, authenticated;
grant execute on function public.is_current_user_admin() to authenticated;

create or replace function public.is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.admin_users
      where user_id = p_user_id
        and role = 'admin'
        and enabled
    );
$$;

revoke all on function public.is_admin(uuid)
  from public, anon, authenticated;
grant execute on function public.is_admin(uuid) to service_role;

create or replace function public.admin_assert_actor(p_actor_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin(p_actor_user_id) then
    raise insufficient_privilege using
      message = 'Administrator access required';
  end if;
end;
$$;

revoke all on function public.admin_assert_actor(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.admin_write_audit(
  p_actor_user_id uuid,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_before_data jsonb,
  p_after_data jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  audit_id uuid;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  insert into public.admin_audit_logs (
    actor_user_id,
    action,
    target_type,
    target_id,
    before_data,
    after_data
  )
  values (
    p_actor_user_id,
    p_action,
    p_target_type,
    p_target_id,
    p_before_data,
    p_after_data
  )
  returning id into audit_id;

  return audit_id;
end;
$$;

revoke all on function public.admin_write_audit(uuid, text, text, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.admin_grant_pro_days(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_days integer,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  pro_plan public.plans%rowtype;
  selected_license public.licenses%rowtype;
  before_data jsonb;
  after_data jsonb;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  if p_target_user_id is null or not exists (
    select 1 from auth.users where id = p_target_user_id
  ) then
    raise foreign_key_violation using message = 'Target user does not exist';
  end if;

  if p_days is null or p_days < 1 or p_days > 3650 then
    raise check_violation using message = 'PRO days must be between 1 and 3650';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_target_user_id::text, 0)
  );

  select *
  into pro_plan
  from public.plans
  where code = 'PRO'
    and enabled;

  if not found then
    raise object_not_in_prerequisite_state using message = 'PRO plan is unavailable';
  end if;

  select coalesce(jsonb_agg(to_jsonb(current_license)), '[]'::jsonb)
  into before_data
  from public.licenses as current_license
  where current_license.user_id = p_target_user_id;

  select current_license.*
  into selected_license
  from public.licenses as current_license
  where current_license.user_id = p_target_user_id
    and current_license.plan_id = pro_plan.id
    and current_license.status = 'active'
    and not current_license.lifetime
    and current_license.expires_at > now()
  order by current_license.expires_at desc, current_license.created_at desc
  limit 1
  for update;

  if found then
    update public.licenses
    set
      expires_at = greatest(selected_license.expires_at, now())
        + pg_catalog.make_interval(days => p_days),
      source = 'admin_grant',
      updated_at = now()
    where id = selected_license.id
    returning * into selected_license;
  else
    insert into public.licenses (
      user_id,
      plan_id,
      status,
      starts_at,
      expires_at,
      lifetime,
      source
    )
    values (
      p_target_user_id,
      pro_plan.id,
      'active',
      now(),
      now() + pg_catalog.make_interval(days => p_days),
      false,
      'admin_grant'
    )
    returning * into selected_license;
  end if;

  after_data := jsonb_build_object(
    'license', to_jsonb(selected_license),
    'days', p_days,
    'reason', nullif(left(btrim(p_reason), 500), '')
  );

  perform public.admin_write_audit(
    p_actor_user_id,
    'license.grant_pro_days',
    'user',
    p_target_user_id::text,
    before_data,
    after_data
  );

  return jsonb_build_object('before', before_data, 'after', after_data);
end;
$$;

create or replace function public.admin_set_plan(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_plan_code text,
  p_expires_at timestamptz,
  p_founder_number integer,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_plan public.plans%rowtype;
  new_license public.licenses%rowtype;
  before_data jsonb;
  after_data jsonb;
  normalized_plan_code text := upper(btrim(p_plan_code));
begin
  perform public.admin_assert_actor(p_actor_user_id);

  if p_target_user_id is null or not exists (
    select 1 from auth.users where id = p_target_user_id
  ) then
    raise foreign_key_violation using message = 'Target user does not exist';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_target_user_id::text, 0)
  );

  select *
  into selected_plan
  from public.plans
  where code = normalized_plan_code
    and enabled;

  if not found then
    raise invalid_parameter_value using message = 'Plan is invalid or disabled';
  end if;

  if normalized_plan_code <> 'FREE'
    and (p_expires_at is null or p_expires_at <= now()) then
    raise check_violation using message = 'A future expiration is required for a temporary plan';
  end if;

  if normalized_plan_code <> 'FOUNDER' and p_founder_number is not null then
    raise check_violation using message = 'Founder number is only valid for FOUNDER';
  end if;

  if p_founder_number is not null and exists (
    select 1
    from public.licenses
    where founder_number = p_founder_number
      and user_id <> p_target_user_id
  ) then
    raise unique_violation using message = 'Founder number is already assigned';
  end if;

  select coalesce(jsonb_agg(to_jsonb(current_license)), '[]'::jsonb)
  into before_data
  from public.licenses as current_license
  where current_license.user_id = p_target_user_id;

  update public.licenses
  set status = 'revoked', updated_at = now()
  where user_id = p_target_user_id
    and status = 'active';

  -- Move an existing Founder number for the same user to the replacement license.
  if p_founder_number is not null then
    update public.licenses
    set founder_number = null, updated_at = now()
    where user_id = p_target_user_id
      and founder_number = p_founder_number;
  end if;

  if normalized_plan_code <> 'FREE' then
    insert into public.licenses (
      user_id,
      plan_id,
      status,
      starts_at,
      expires_at,
      lifetime,
      founder_number,
      source
    )
    values (
      p_target_user_id,
      selected_plan.id,
      'active',
      now(),
      p_expires_at,
      false,
      p_founder_number,
      'admin_plan_change'
    )
    returning * into new_license;
  end if;

  after_data := jsonb_build_object(
    'plan_code', normalized_plan_code,
    'license', case
      when normalized_plan_code = 'FREE' then null
      else to_jsonb(new_license)
    end,
    'reason', nullif(left(btrim(p_reason), 500), '')
  );

  perform public.admin_write_audit(
    p_actor_user_id,
    'license.set_plan',
    'user',
    p_target_user_id::text,
    before_data,
    after_data
  );

  return jsonb_build_object('before', before_data, 'after', after_data);
end;
$$;

create or replace function public.admin_activate_lifetime(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_plan_code text,
  p_founder_number integer,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_plan public.plans%rowtype;
  new_license public.licenses%rowtype;
  before_data jsonb;
  after_data jsonb;
  normalized_plan_code text := upper(btrim(p_plan_code));
begin
  perform public.admin_assert_actor(p_actor_user_id);

  if p_target_user_id is null or not exists (
    select 1 from auth.users where id = p_target_user_id
  ) then
    raise foreign_key_violation using message = 'Target user does not exist';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_target_user_id::text, 0)
  );

  select *
  into selected_plan
  from public.plans
  where code = normalized_plan_code
    and enabled
    and is_lifetime_available;

  if not found or normalized_plan_code = 'FREE' then
    raise invalid_parameter_value using message = 'Lifetime plan is invalid or unavailable';
  end if;

  if normalized_plan_code <> 'FOUNDER' and p_founder_number is not null then
    raise check_violation using message = 'Founder number is only valid for FOUNDER';
  end if;

  if p_founder_number is not null and exists (
    select 1
    from public.licenses
    where founder_number = p_founder_number
      and user_id <> p_target_user_id
  ) then
    raise unique_violation using message = 'Founder number is already assigned';
  end if;

  select coalesce(jsonb_agg(to_jsonb(current_license)), '[]'::jsonb)
  into before_data
  from public.licenses as current_license
  where current_license.user_id = p_target_user_id;

  update public.licenses
  set status = 'revoked', updated_at = now()
  where user_id = p_target_user_id
    and status = 'active';

  -- Preserve a user's Founder identity while replacing the underlying license row.
  if p_founder_number is not null then
    update public.licenses
    set founder_number = null, updated_at = now()
    where user_id = p_target_user_id
      and founder_number = p_founder_number;
  end if;

  insert into public.licenses (
    user_id,
    plan_id,
    status,
    starts_at,
    expires_at,
    lifetime,
    founder_number,
    source
  )
  values (
    p_target_user_id,
    selected_plan.id,
    'active',
    now(),
    null,
    true,
    p_founder_number,
    'admin_lifetime'
  )
  returning * into new_license;

  after_data := jsonb_build_object(
    'plan_code', normalized_plan_code,
    'license', to_jsonb(new_license),
    'reason', nullif(left(btrim(p_reason), 500), '')
  );

  perform public.admin_write_audit(
    p_actor_user_id,
    'license.activate_lifetime',
    'user',
    p_target_user_id::text,
    before_data,
    after_data
  );

  return jsonb_build_object('before', before_data, 'after', after_data);
end;
$$;

create or replace function public.admin_revoke_license(
  p_actor_user_id uuid,
  p_license_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  before_license public.licenses%rowtype;
  after_license public.licenses%rowtype;
  after_data jsonb;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  select *
  into before_license
  from public.licenses
  where id = p_license_id
  for update;

  if not found then
    raise no_data_found using message = 'License does not exist';
  end if;

  update public.licenses
  set status = 'revoked', updated_at = now()
  where id = p_license_id
  returning * into after_license;

  after_data := to_jsonb(after_license) || jsonb_build_object(
    'reason', nullif(left(btrim(p_reason), 500), '')
  );

  perform public.admin_write_audit(
    p_actor_user_id,
    'license.revoke',
    'license',
    p_license_id::text,
    to_jsonb(before_license),
    after_data
  );

  return jsonb_build_object(
    'before', to_jsonb(before_license),
    'after', after_data
  );
end;
$$;

create or replace function public.admin_revoke_device(
  p_actor_user_id uuid,
  p_device_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  before_device public.devices%rowtype;
  after_device public.devices%rowtype;
  after_data jsonb;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  select *
  into before_device
  from public.devices
  where id = p_device_id
  for update;

  if not found then
    raise no_data_found using message = 'Device does not exist';
  end if;

  update public.devices
  set revoked_at = coalesce(revoked_at, now())
  where id = p_device_id
  returning * into after_device;

  after_data := to_jsonb(after_device) || jsonb_build_object(
    'reason', nullif(left(btrim(p_reason), 500), '')
  );

  perform public.admin_write_audit(
    p_actor_user_id,
    'device.revoke',
    'device',
    p_device_id::text,
    to_jsonb(before_device),
    after_data
  );

  return jsonb_build_object(
    'before', to_jsonb(before_device),
    'after', after_data
  );
end;
$$;

create or replace function public.admin_reset_device(
  p_actor_user_id uuid,
  p_device_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  before_device public.devices%rowtype;
  after_device public.devices%rowtype;
  after_data jsonb;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  select *
  into before_device
  from public.devices
  where id = p_device_id
  for update;

  if not found then
    raise no_data_found using message = 'Device does not exist';
  end if;

  -- Reset means clearing the server-side revocation so this known device may enroll again.
  update public.devices
  set revoked_at = null
  where id = p_device_id
  returning * into after_device;

  after_data := to_jsonb(after_device) || jsonb_build_object(
    'reason', nullif(left(btrim(p_reason), 500), '')
  );

  perform public.admin_write_audit(
    p_actor_user_id,
    'device.reset',
    'device',
    p_device_id::text,
    to_jsonb(before_device),
    after_data
  );

  return jsonb_build_object(
    'before', to_jsonb(before_device),
    'after', after_data
  );
end;
$$;

create or replace function public.admin_is_safe_web_url(
  p_url text,
  p_allow_null boolean
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_url is null then p_allow_null
    when btrim(p_url) = '' or btrim(p_url) ~ '[[:space:]]' then false
    when position(
      '@' in split_part(split_part(btrim(p_url), '://', 2), '/', 1)
    ) > 0 then false
    when lower(btrim(p_url)) ~ '^https://[^/]+(/.*)?$' then true
    when lower(btrim(p_url))
      ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?(/.*)?$'
      then true
    else false
  end;
$$;

revoke all on function public.admin_is_safe_web_url(text, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.admin_create_game(
  p_actor_user_id uuid,
  p_name text,
  p_slug text,
  p_launch_url text,
  p_developer_referral_url text,
  p_icon_url text,
  p_enabled boolean,
  p_sort_order integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  created_game public.games%rowtype;
  normalized_referral_url text := nullif(btrim(p_developer_referral_url), '');
  normalized_icon_url text := nullif(btrim(p_icon_url), '');
begin
  perform public.admin_assert_actor(p_actor_user_id);

  if nullif(btrim(p_name), '') is null then
    raise check_violation using message = 'Game name is required';
  end if;

  if lower(btrim(p_slug)) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise check_violation using message = 'Game slug is invalid';
  end if;

  if not public.admin_is_safe_web_url(btrim(p_launch_url), false)
    or not public.admin_is_safe_web_url(normalized_referral_url, true)
    or not public.admin_is_safe_web_url(normalized_icon_url, true) then
    raise check_violation using message = 'Game URL is unsafe or invalid';
  end if;

  insert into public.games (
    name,
    slug,
    launch_url,
    developer_referral_url,
    icon_url,
    enabled,
    sort_order
  )
  values (
    btrim(p_name),
    lower(btrim(p_slug)),
    btrim(p_launch_url),
    normalized_referral_url,
    normalized_icon_url,
    coalesce(p_enabled, true),
    coalesce(p_sort_order, 0)
  )
  returning * into created_game;

  perform public.admin_write_audit(
    p_actor_user_id,
    'game.create',
    'game',
    created_game.id::text,
    null,
    to_jsonb(created_game)
  );

  return jsonb_build_object('before', null, 'after', to_jsonb(created_game));
end;
$$;

create or replace function public.admin_update_game(
  p_actor_user_id uuid,
  p_game_id uuid,
  p_name text,
  p_slug text,
  p_launch_url text,
  p_developer_referral_url text,
  p_icon_url text,
  p_enabled boolean,
  p_sort_order integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  before_game public.games%rowtype;
  after_game public.games%rowtype;
  normalized_referral_url text := nullif(btrim(p_developer_referral_url), '');
  normalized_icon_url text := nullif(btrim(p_icon_url), '');
begin
  perform public.admin_assert_actor(p_actor_user_id);

  select *
  into before_game
  from public.games
  where id = p_game_id
  for update;

  if not found then
    raise no_data_found using message = 'Game does not exist';
  end if;

  if nullif(btrim(p_name), '') is null then
    raise check_violation using message = 'Game name is required';
  end if;

  if lower(btrim(p_slug)) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise check_violation using message = 'Game slug is invalid';
  end if;

  if not public.admin_is_safe_web_url(btrim(p_launch_url), false)
    or not public.admin_is_safe_web_url(normalized_referral_url, true)
    or not public.admin_is_safe_web_url(normalized_icon_url, true) then
    raise check_violation using message = 'Game URL is unsafe or invalid';
  end if;

  update public.games
  set
    name = btrim(p_name),
    slug = lower(btrim(p_slug)),
    launch_url = btrim(p_launch_url),
    developer_referral_url = normalized_referral_url,
    icon_url = normalized_icon_url,
    enabled = coalesce(p_enabled, false),
    sort_order = coalesce(p_sort_order, 0),
    updated_at = now()
  where id = p_game_id
  returning * into after_game;

  perform public.admin_write_audit(
    p_actor_user_id,
    'game.update',
    'game',
    p_game_id::text,
    to_jsonb(before_game),
    to_jsonb(after_game)
  );

  return jsonb_build_object(
    'before', to_jsonb(before_game),
    'after', to_jsonb(after_game)
  );
end;
$$;

create or replace function public.admin_reorder_games(
  p_actor_user_id uuid,
  p_game_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  before_data jsonb;
  after_data jsonb;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  if p_game_ids is null or cardinality(p_game_ids) = 0 then
    raise check_violation using message = 'At least one game is required';
  end if;

  if exists (select 1 from unnest(p_game_ids) as item(id) where id is null)
    or (select count(distinct id) from unnest(p_game_ids) as item(id))
      <> cardinality(p_game_ids) then
    raise check_violation using message = 'Game ordering contains null or duplicate IDs';
  end if;

  if (select count(*) from public.games where id = any(p_game_ids))
    <> cardinality(p_game_ids) then
    raise no_data_found using message = 'One or more games do not exist';
  end if;

  select jsonb_agg(to_jsonb(game_row) order by game_row.sort_order, game_row.slug)
  into before_data
  from public.games as game_row
  where game_row.id = any(p_game_ids);

  with requested_order as (
    select item.game_id, item.position
    from unnest(p_game_ids) with ordinality as item(game_id, position)
  )
  update public.games as game_row
  set
    sort_order = (requested_order.position * 10)::integer,
    updated_at = now()
  from requested_order
  where game_row.id = requested_order.game_id;

  select jsonb_agg(to_jsonb(game_row) order by game_row.sort_order, game_row.slug)
  into after_data
  from public.games as game_row
  where game_row.id = any(p_game_ids);

  perform public.admin_write_audit(
    p_actor_user_id,
    'game.reorder',
    'game_catalog',
    'all',
    before_data,
    after_data
  );

  return jsonb_build_object('before', before_data, 'after', after_data);
end;
$$;

create or replace function public.admin_update_config(
  p_actor_user_id uuid,
  p_key text,
  p_value jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_key text := lower(btrim(p_key));
  before_config public.app_config%rowtype;
  after_config public.app_config%rowtype;
  integer_value numeric;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  if normalized_key not in (
    'referral_referrer_days',
    'referral_referred_days',
    'founder_max_sales'
  ) then
    raise invalid_parameter_value using message = 'Config key is not administrable';
  end if;

  if normalized_key = 'founder_max_sales' and p_value = 'null'::jsonb then
    integer_value := null;
  elsif jsonb_typeof(p_value) = 'number' then
    integer_value := (p_value #>> '{}')::numeric;
  else
    raise check_violation using message = 'Config value must be an integer';
  end if;

  if integer_value is not null and integer_value <> trunc(integer_value) then
    raise check_violation using message = 'Config value must be an integer';
  end if;

  if normalized_key in ('referral_referrer_days', 'referral_referred_days')
    and (integer_value is null or integer_value < 0 or integer_value > 3650) then
    raise check_violation using message = 'Referral days must be between 0 and 3650';
  end if;

  if normalized_key = 'founder_max_sales'
    and integer_value is not null
    and (integer_value < 1 or integer_value > 1000000) then
    raise check_violation using message = 'Founder sales limit is invalid';
  end if;

  select *
  into before_config
  from public.app_config
  where key = normalized_key
  for update;

  insert into public.app_config (key, value, is_public)
  values (normalized_key, p_value, false)
  on conflict (key) do update
  set value = excluded.value, updated_at = now()
  returning * into after_config;

  perform public.admin_write_audit(
    p_actor_user_id,
    'config.update',
    'app_config',
    normalized_key,
    case when before_config.key is null then null else to_jsonb(before_config) end,
    to_jsonb(after_config)
  );

  return jsonb_build_object(
    'before', case when before_config.key is null then null else to_jsonb(before_config) end,
    'after', to_jsonb(after_config)
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

  if normalized_code not in ('PRO_LIFETIME', 'FOUNDER_LIFETIME') then
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

create or replace function public.admin_search_users(
  p_actor_user_id uuid,
  p_query text,
  p_page integer,
  p_page_size integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_query text := left(btrim(coalesce(p_query, '')), 200);
  result jsonb;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  if p_page is null or p_page < 1 or p_page > 100000 then
    raise check_violation using message = 'Page is invalid';
  end if;

  if p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise check_violation using message = 'Page size must be between 1 and 100';
  end if;

  with matching_users as materialized (
    select
      auth_user.id as user_id,
      auth_user.email,
      auth_user.created_at,
      auth_user.last_sign_in_at,
      profile.display_name,
      profile.referral_code
    from auth.users as auth_user
    left join public.profiles as profile on profile.user_id = auth_user.id
    where normalized_query = ''
      or coalesce(auth_user.email, '') ilike '%' || normalized_query || '%'
      or auth_user.id::text ilike '%' || normalized_query || '%'
      or coalesce(profile.referral_code, '') ilike '%' || normalized_query || '%'
  ),
  paged_users as (
    select matching_users.*
    from matching_users
    order by created_at desc, user_id
    limit p_page_size
    offset ((p_page - 1) * p_page_size)
  ),
  enriched_users as (
    select
      paged_user.*,
      coalesce(current_access.plan_code, 'FREE') as plan_code,
      current_access.license_status,
      current_access.expires_at,
      coalesce(current_access.lifetime, false) as lifetime,
      current_access.founder_number
    from paged_users as paged_user
    left join lateral (
      select
        plan.code as plan_code,
        license.status as license_status,
        license.expires_at,
        license.lifetime,
        license.founder_number
      from public.licenses as license
      join public.plans as plan on plan.id = license.plan_id
      where license.user_id = paged_user.user_id
        and license.status = 'active'
        and license.starts_at <= now()
        and (license.lifetime or license.expires_at > now())
      order by
        license.lifetime desc,
        plan.entitlement_rank desc,
        license.expires_at desc nulls first,
        license.created_at desc
      limit 1
    ) as current_access on true
  )
  select jsonb_build_object(
    'page', p_page,
    'page_size', p_page_size,
    'total', (select count(*) from matching_users),
    'items', coalesce(
      (select jsonb_agg(to_jsonb(enriched_user) order by enriched_user.created_at desc)
       from enriched_users as enriched_user),
      '[]'::jsonb
    )
  )
  into result;

  return result;
end;
$$;

create or replace function public.admin_get_user_detail(
  p_actor_user_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  user_data jsonb;
  profile_data jsonb;
  current_access_data jsonb;
  licenses_data jsonb;
  devices_data jsonb;
  referrals_data jsonb;
  payments_data jsonb;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  select jsonb_build_object(
    'id', auth_user.id,
    'email', auth_user.email,
    'created_at', auth_user.created_at,
    'last_sign_in_at', auth_user.last_sign_in_at,
    'email_confirmed_at', auth_user.email_confirmed_at
  )
  into user_data
  from auth.users as auth_user
  where auth_user.id = p_user_id;

  if user_data is null then
    raise no_data_found using message = 'User does not exist';
  end if;

  select to_jsonb(profile)
  into profile_data
  from public.profiles as profile
  where profile.user_id = p_user_id;

  select jsonb_build_object(
    'license_id', license.id,
    'plan_code', plan.code,
    'plan_name', plan.name,
    'license_status', license.status,
    'starts_at', license.starts_at,
    'expires_at', license.expires_at,
    'lifetime', license.lifetime,
    'founder_number', license.founder_number,
    'source', license.source
  )
  into current_access_data
  from public.licenses as license
  join public.plans as plan on plan.id = license.plan_id
  where license.user_id = p_user_id
    and license.status = 'active'
    and license.starts_at <= now()
    and (license.lifetime or license.expires_at > now())
  order by
    license.lifetime desc,
    plan.entitlement_rank desc,
    license.expires_at desc nulls first,
    license.created_at desc
  limit 1;

  if current_access_data is null then
    current_access_data := jsonb_build_object(
      'license_id', null,
      'plan_code', 'FREE',
      'plan_name', 'Free',
      'license_status', null,
      'starts_at', null,
      'expires_at', null,
      'lifetime', false,
      'founder_number', null,
      'source', null
    );
  end if;

  select coalesce(
    jsonb_agg(
      to_jsonb(license) || jsonb_build_object('plan_code', plan.code)
      order by license.created_at desc
    ),
    '[]'::jsonb
  )
  into licenses_data
  from public.licenses as license
  join public.plans as plan on plan.id = license.plan_id
  where license.user_id = p_user_id;

  select coalesce(
    jsonb_agg(to_jsonb(device) order by device.last_seen_at desc),
    '[]'::jsonb
  )
  into devices_data
  from public.devices as device
  where device.user_id = p_user_id;

  select jsonb_build_object(
    'as_referrer', coalesce(
      (
        select jsonb_agg(to_jsonb(referral) order by referral.created_at desc)
        from public.referrals as referral
        where referral.referrer_user_id = p_user_id
      ),
      '[]'::jsonb
    ),
    'as_referred', coalesce(
      (
        select jsonb_agg(to_jsonb(referral) order by referral.created_at desc)
        from public.referrals as referral
        where referral.referred_user_id = p_user_id
      ),
      '[]'::jsonb
    )
  )
  into referrals_data;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', payment.id,
        'provider', payment.provider,
        'provider_payment_id', payment.provider_payment_id,
        'product_code', payment.product_code,
        'amount', payment.amount,
        'currency', payment.currency,
        'status', payment.status,
        'fulfilled_at', payment.fulfilled_at,
        'created_at', payment.created_at,
        'paid_at', payment.paid_at
      )
      order by payment.created_at desc
    ),
    '[]'::jsonb
  )
  into payments_data
  from public.payments as payment
  where payment.user_id = p_user_id;

  return jsonb_build_object(
    'user', user_data,
    'profile', profile_data,
    'current_access', current_access_data,
    'licenses', licenses_data,
    'devices', devices_data,
    'referrals', referrals_data,
    'payments', payments_data
  );
end;
$$;

revoke all on function public.admin_grant_pro_days(uuid, uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.admin_set_plan(uuid, uuid, text, timestamptz, integer, text)
  from public, anon, authenticated;
revoke all on function public.admin_activate_lifetime(uuid, uuid, text, integer, text)
  from public, anon, authenticated;
revoke all on function public.admin_revoke_license(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_revoke_device(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_reset_device(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_create_game(uuid, text, text, text, text, text, boolean, integer)
  from public, anon, authenticated;
revoke all on function public.admin_update_game(uuid, uuid, text, text, text, text, text, boolean, integer)
  from public, anon, authenticated;
revoke all on function public.admin_reorder_games(uuid, uuid[])
  from public, anon, authenticated;
revoke all on function public.admin_update_config(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.admin_update_product(uuid, text, numeric, text, boolean)
  from public, anon, authenticated;
revoke all on function public.admin_search_users(uuid, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.admin_get_user_detail(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.admin_grant_pro_days(uuid, uuid, integer, text)
  to service_role;
grant execute on function public.admin_set_plan(uuid, uuid, text, timestamptz, integer, text)
  to service_role;
grant execute on function public.admin_activate_lifetime(uuid, uuid, text, integer, text)
  to service_role;
grant execute on function public.admin_revoke_license(uuid, uuid, text)
  to service_role;
grant execute on function public.admin_revoke_device(uuid, uuid, text)
  to service_role;
grant execute on function public.admin_reset_device(uuid, uuid, text)
  to service_role;
grant execute on function public.admin_create_game(uuid, text, text, text, text, text, boolean, integer)
  to service_role;
grant execute on function public.admin_update_game(uuid, uuid, text, text, text, text, text, boolean, integer)
  to service_role;
grant execute on function public.admin_reorder_games(uuid, uuid[])
  to service_role;
grant execute on function public.admin_update_config(uuid, text, jsonb)
  to service_role;
grant execute on function public.admin_update_product(uuid, text, numeric, text, boolean)
  to service_role;
grant execute on function public.admin_search_users(uuid, text, integer, integer)
  to service_role;
grant execute on function public.admin_get_user_detail(uuid, uuid)
  to service_role;

comment on function public.admin_reset_device(uuid, uuid, text) is
  'Clears revoked_at for a known device; it does not delete device history.';

comment on function public.admin_search_users(uuid, text, integer, integer) is
  'Server-only paginated user search. Deliberately excludes Auth raw metadata and tokens.';

commit;
