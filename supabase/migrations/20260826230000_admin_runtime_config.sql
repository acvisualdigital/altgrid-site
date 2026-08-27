begin;

-- Move the already deployed 2.x runtime gate back to the current pre-1.0
-- release line. This seed is intentionally idempotent for existing projects.
insert into public.app_config (key, value, is_public)
values
  ('maintenance', 'false'::jsonb, true),
  ('minimum_version', '"0.9.0-beta.1"'::jsonb, true),
  ('latest_version', '"0.9.0-beta.1"'::jsonb, true),
  ('update_channel', '"beta"'::jsonb, true)
on conflict (key) do update
set
  value = excluded.value,
  is_public = excluded.is_public,
  updated_at = now();

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
  text_value text;
  public_value boolean;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  if normalized_key is null or normalized_key not in (
    'referral_referrer_days',
    'referral_referred_days',
    'founder_max_sales',
    'maintenance',
    'minimum_version',
    'latest_version',
    'update_channel'
  ) then
    raise invalid_parameter_value using message = 'Config key is not administrable';
  end if;

  public_value := normalized_key in (
    'maintenance',
    'minimum_version',
    'latest_version',
    'update_channel'
  );

  if normalized_key in (
    'referral_referrer_days',
    'referral_referred_days',
    'founder_max_sales'
  ) then
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
  elsif normalized_key = 'maintenance' then
    if jsonb_typeof(p_value) <> 'boolean' then
      raise check_violation using message = 'Maintenance must be a boolean';
    end if;
  elsif normalized_key in ('minimum_version', 'latest_version') then
    if jsonb_typeof(p_value) <> 'string' then
      raise check_violation using message = 'Version must be a SemVer string';
    end if;

    text_value := p_value #>> '{}';
    if char_length(text_value) > 100 or text_value !~
      '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-((0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(\.(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(\+([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?$'
    then
      raise check_violation using message = 'Version must be valid SemVer';
    end if;
  elsif normalized_key = 'update_channel' then
    if jsonb_typeof(p_value) <> 'string'
      or (p_value #>> '{}') not in ('beta', 'stable') then
      raise check_violation using message = 'Update channel must be beta or stable';
    end if;
  end if;

  select *
  into before_config
  from public.app_config
  where key = normalized_key
  for update;

  insert into public.app_config (key, value, is_public)
  values (normalized_key, p_value, public_value)
  on conflict (key) do update
  set
    value = excluded.value,
    is_public = excluded.is_public,
    updated_at = now()
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

revoke all on function public.admin_update_config(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_update_config(uuid, text, jsonb)
  to service_role;

commit;
