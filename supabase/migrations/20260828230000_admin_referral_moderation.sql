begin;

create or replace function public.admin_referral_log_item(p_referral_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', referral.id,
    'referrer_user_id', referral.referrer_user_id,
    'referred_user_id', referral.referred_user_id,
    'campaign_id', referral.campaign_id,
    'campaign_name', campaign.name,
    'status', referral.status,
    'qualification_reason', referral.qualification_reason,
    'created_at', referral.created_at,
    'qualified_at', referral.qualified_at,
    'rewarded_at', referral.rewarded_at,
    'referrer_email', referrer.email,
    'referrer_display_name', referrer_profile.display_name,
    'referrer_code', referrer_profile.referral_code,
    'referred_email', referred.email,
    'referred_display_name', referred_profile.display_name,
    'device_hint', case
      when referral.qualification_device_hash is null then null
      else '••••' || right(referral.qualification_device_hash, 8)
    end,
    'reward_days', coalesce((
      select sum(reward.reward_days)::integer
      from public.referral_rewards as reward
      where reward.referral_id = referral.id
        and reward.beneficiary_user_id = referral.referrer_user_id
        and reward.reward_type = 'pro_days'
    ), 0)
  )
  from public.referrals as referral
  join auth.users as referrer on referrer.id = referral.referrer_user_id
  join auth.users as referred on referred.id = referral.referred_user_id
  left join public.profiles as referrer_profile
    on referrer_profile.user_id = referral.referrer_user_id
  left join public.profiles as referred_profile
    on referred_profile.user_id = referral.referred_user_id
  left join public.referral_campaigns as campaign on campaign.id = referral.campaign_id
  where referral.id = p_referral_id;
$$;

revoke all on function public.admin_referral_log_item(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.admin_list_referrals(
  p_actor_user_id uuid,
  p_status text default null,
  p_query text default '',
  p_page integer default 1,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_query text := lower(btrim(coalesce(p_query, '')));
  row_offset integer;
  result jsonb;
begin
  perform public.admin_assert_actor(p_actor_user_id);

  if p_status is not null and p_status not in ('pending', 'qualified', 'rewarded', 'rejected') then
    raise invalid_parameter_value using message = 'Invalid referral status';
  end if;
  if p_page is null or p_page < 1 or p_page_size is null or p_page_size < 1 or p_page_size > 100 then
    raise invalid_parameter_value using message = 'Invalid pagination';
  end if;

  row_offset := (p_page - 1) * p_page_size;

  with searchable as (
    select referral.id, referral.created_at, referral.status
    from public.referrals as referral
    join auth.users as referrer on referrer.id = referral.referrer_user_id
    join auth.users as referred on referred.id = referral.referred_user_id
    left join public.profiles as referrer_profile
      on referrer_profile.user_id = referral.referrer_user_id
    left join public.profiles as referred_profile
      on referred_profile.user_id = referral.referred_user_id
    where (p_status is null or referral.status = p_status)
      and (
        normalized_query = ''
        or lower(coalesce(referrer.email, '')) like '%' || normalized_query || '%'
        or lower(coalesce(referred.email, '')) like '%' || normalized_query || '%'
        or lower(coalesce(referrer_profile.display_name, '')) like '%' || normalized_query || '%'
        or lower(coalesce(referred_profile.display_name, '')) like '%' || normalized_query || '%'
        or lower(coalesce(referrer_profile.referral_code, '')) like '%' || normalized_query || '%'
        or referral.id::text = normalized_query
        or referral.referrer_user_id::text = normalized_query
        or referral.referred_user_id::text = normalized_query
      )
  ), page_rows as (
    select searchable.id
    from searchable
    order by searchable.created_at desc, searchable.id desc
    limit p_page_size offset row_offset
  )
  select jsonb_build_object(
    'page', p_page,
    'page_size', p_page_size,
    'total', (select count(*) from searchable),
    'stats', jsonb_build_object(
      'total', (select count(*) from public.referrals),
      'pending', (select count(*) from public.referrals where status = 'pending'),
      'qualified', (select count(*) from public.referrals where status = 'qualified'),
      'rewarded', (select count(*) from public.referrals where status = 'rewarded'),
      'rejected', (select count(*) from public.referrals where status = 'rejected')
    ),
    'items', coalesce((
      select jsonb_agg(public.admin_referral_log_item(page_rows.id))
      from page_rows
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_list_referrals(uuid, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_list_referrals(uuid, text, text, integer, integer)
  to service_role;

create or replace function public.admin_approve_referral(
  p_actor_user_id uuid,
  p_referral_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  referral_row public.referrals%rowtype;
  before_data jsonb;
  after_data jsonb;
  pro_plan_id uuid;
  current_pro_expiry timestamptz;
  reward_inserted boolean := false;
  safe_reason text := btrim(coalesce(p_reason, ''));
begin
  perform public.admin_assert_actor(p_actor_user_id);
  if char_length(safe_reason) < 3 or char_length(safe_reason) > 500 then
    raise invalid_parameter_value using message = 'Approval reason must have 3 to 500 characters';
  end if;

  select * into referral_row
  from public.referrals
  where id = p_referral_id
  for update;
  if not found then raise no_data_found using message = 'Referral not found'; end if;

  before_data := public.admin_referral_log_item(p_referral_id);

  if referral_row.status <> 'rewarded' then
    select id into pro_plan_id from public.plans where code = 'PRO' and enabled;
    if pro_plan_id is null then
      raise object_not_in_prerequisite_state using message = 'PRO plan is unavailable';
    end if;

    insert into public.referral_rewards (
      referral_id, beneficiary_user_id, reward_type, reward_days, metadata
    ) values (
      referral_row.id,
      referral_row.referrer_user_id,
      'pro_days',
      1,
      jsonb_build_object(
        'qualification', 'manual_admin_approval',
        'reason', safe_reason,
        'actor_user_id', p_actor_user_id
      )
    )
    on conflict (referral_id, beneficiary_user_id, reward_type) do nothing
    returning true into reward_inserted;

    if coalesce(reward_inserted, false) then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(referral_row.referrer_user_id::text, 1)
      );
      select greatest(now(), coalesce(max(license.expires_at), now()))
      into current_pro_expiry
      from public.licenses as license
      where license.user_id = referral_row.referrer_user_id
        and license.plan_id = pro_plan_id
        and license.status = 'active'
        and not license.lifetime
        and license.expires_at > now();

      insert into public.licenses (
        user_id, plan_id, status, starts_at, expires_at, lifetime, source
      ) values (
        referral_row.referrer_user_id, pro_plan_id, 'active', now(),
        current_pro_expiry + interval '1 day', false, 'referral-program'
      )
      on conflict (user_id, source) where source = 'referral-program'
      do update set
        plan_id = excluded.plan_id,
        status = 'active',
        expires_at = greatest(now(), public.licenses.expires_at) + interval '1 day',
        updated_at = now();
    end if;

    update public.referrals
    set status = 'rewarded',
        qualification_reason = 'manual_admin_approval: ' || safe_reason,
        qualification_device_hash = null,
        qualified_at = coalesce(qualified_at, now()),
        rewarded_at = now()
    where id = p_referral_id;
  end if;

  after_data := public.admin_referral_log_item(p_referral_id);
  perform public.admin_write_audit(
    p_actor_user_id, 'referral.approve', 'referral', p_referral_id::text,
    before_data, after_data
  );
  return after_data;
end;
$$;

revoke all on function public.admin_approve_referral(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_approve_referral(uuid, uuid, text)
  to service_role;

create or replace function public.admin_reject_referral(
  p_actor_user_id uuid,
  p_referral_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  referral_row public.referrals%rowtype;
  referral_license public.licenses%rowtype;
  before_data jsonb;
  after_data jsonb;
  removed_days integer := 0;
  safe_reason text := btrim(coalesce(p_reason, ''));
  adjusted_expiry timestamptz;
begin
  perform public.admin_assert_actor(p_actor_user_id);
  if char_length(safe_reason) < 3 or char_length(safe_reason) > 500 then
    raise invalid_parameter_value using message = 'Rejection reason must have 3 to 500 characters';
  end if;

  select * into referral_row
  from public.referrals
  where id = p_referral_id
  for update;
  if not found then raise no_data_found using message = 'Referral not found'; end if;

  before_data := public.admin_referral_log_item(p_referral_id);

  select coalesce(sum(reward_days), 0)::integer into removed_days
  from public.referral_rewards
  where referral_id = p_referral_id
    and beneficiary_user_id = referral_row.referrer_user_id
    and reward_type = 'pro_days';

  delete from public.referral_rewards
  where referral_id = p_referral_id
    and beneficiary_user_id = referral_row.referrer_user_id
    and reward_type = 'pro_days';

  if removed_days > 0 then
    select * into referral_license
    from public.licenses
    where user_id = referral_row.referrer_user_id
      and source = 'referral-program'
    for update;

    if found and referral_license.expires_at is not null then
      adjusted_expiry := referral_license.expires_at - make_interval(days => removed_days);
      update public.licenses
      set expires_at = greatest(starts_at + interval '1 second', adjusted_expiry),
          status = case when adjusted_expiry <= now() then 'expired' else status end,
          updated_at = now()
      where id = referral_license.id;
    end if;
  end if;

  update public.referrals
  set status = 'rejected',
      qualification_reason = 'manual_admin_rejection: ' || safe_reason,
      qualification_device_hash = null,
      rewarded_at = null
  where id = p_referral_id;

  after_data := public.admin_referral_log_item(p_referral_id);
  perform public.admin_write_audit(
    p_actor_user_id, 'referral.reject', 'referral', p_referral_id::text,
    before_data, after_data
  );
  return after_data;
end;
$$;

revoke all on function public.admin_reject_referral(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_reject_referral(uuid, uuid, text)
  to service_role;

commit;
