begin;

alter table public.plans
  add column features jsonb not null default '{}'::jsonb,
  add column entitlement_rank integer not null default 0;

alter table public.plans
  add constraint plans_features_object_check
    check (jsonb_typeof(features) = 'object'),
  add constraint plans_entitlement_rank_nonnegative_check
    check (entitlement_rank >= 0);

alter table public.entitlements
  add column priority integer not null default 0;

alter table public.entitlements
  add constraint entitlements_feature_key_format_check
    check (feature_key ~ '^[a-z][a-z0-9_]{0,63}$') not valid,
  add constraint entitlements_boolean_value_check
    check (feature_value is not null and jsonb_typeof(feature_value) = 'boolean') not valid;

alter table public.licenses
  add constraint licenses_temporary_expiration_required_check
    check (lifetime or expires_at is not null) not valid;

alter table public.app_config
  add column is_public boolean not null default false;

create or replace function public.validate_license_lifetime_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  lifetime_available boolean;
begin
  if not new.lifetime then
    return new;
  end if;

  select plans.is_lifetime_available
  into lifetime_available
  from public.plans
  where plans.id = new.plan_id;

  if lifetime_available is false then
    raise check_violation using
      constraint = 'licenses_lifetime_plan_availability_check',
      message = 'lifetime licenses are not available for this plan';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_license_lifetime_availability()
from public, anon, authenticated;

create trigger licenses_validate_lifetime_availability
before insert or update of plan_id, lifetime on public.licenses
for each row execute function public.validate_license_lifetime_availability();

create index entitlements_user_resolution_idx
  on public.entitlements (
    user_id,
    feature_key,
    priority desc,
    starts_at desc,
    created_at desc,
    id desc
  );

create index app_config_public_key_idx
  on public.app_config (key)
  where is_public;

insert into public.plans (
  code,
  name,
  max_accounts,
  enabled,
  is_lifetime_available,
  sort_order,
  entitlement_rank,
  features,
  metadata
)
values
  (
    'FREE',
    'Free',
    2,
    true,
    false,
    10,
    0,
    '{
      "basic_grids": true,
      "fullscreen_sessions": true,
      "game_presets": true,
      "advanced_grids": false,
      "eco_mode": false,
      "session_restore": false,
      "founder_badge": false,
      "beta_features": false
    }'::jsonb,
    '{}'::jsonb
  ),
  (
    'PRO',
    'Pro',
    10,
    true,
    true,
    20,
    100,
    '{
      "basic_grids": true,
      "fullscreen_sessions": true,
      "game_presets": true,
      "advanced_grids": true,
      "eco_mode": true,
      "session_restore": true,
      "founder_badge": false,
      "beta_features": false
    }'::jsonb,
    '{}'::jsonb
  ),
  (
    'FOUNDER',
    'Founder',
    20,
    true,
    true,
    30,
    200,
    '{
      "basic_grids": true,
      "fullscreen_sessions": true,
      "game_presets": true,
      "advanced_grids": true,
      "eco_mode": true,
      "session_restore": true,
      "founder_badge": true,
      "beta_features": true
    }'::jsonb,
    '{}'::jsonb
  )
on conflict (code) do update
set
  features = excluded.features,
  entitlement_rank = excluded.entitlement_rank,
  updated_at = now();

comment on column public.plans.features is
  'Feature flags resolved by the backend entitlement engine.';

comment on column public.plans.entitlement_rank is
  'Plan priority within the same license lifetime class; independent of visual sort_order.';

comment on column public.entitlements.priority is
  'Deterministic priority for concurrent individual feature overrides.';

comment on column public.app_config.is_public is
  'Explicit publication gate. The Worker also applies a fixed key allowlist.';

commit;
