begin;

create table public.referral_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active',
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint referral_campaigns_name_not_blank_check check (btrim(name) <> ''),
  constraint referral_campaigns_period_check check (ends_at > starts_at),
  constraint referral_campaigns_status_check check (status in ('active', 'finalized')),
  constraint referral_campaigns_finalized_check check (
    (status = 'active' and finalized_at is null)
    or (status = 'finalized' and finalized_at is not null)
  )
);

create unique index referral_campaigns_one_active_idx
  on public.referral_campaigns ((status))
  where status = 'active';

create trigger referral_campaigns_set_updated_at
before update on public.referral_campaigns
for each row execute function public.set_updated_at();

insert into public.referral_campaigns (name, starts_at, ends_at)
values (
  'Corrida de Indicações — Lançamento',
  '2026-08-28 00:00:00-03'::timestamptz,
  '2026-09-30 23:59:59-03'::timestamptz
);

alter table public.referrals
  add column campaign_id uuid references public.referral_campaigns (id) on delete restrict,
  add column qualification_device_hash text;

update public.referrals as referral
set campaign_id = campaign.id
from public.referral_campaigns as campaign
where referral.campaign_id is null
  and referral.created_at >= campaign.starts_at
  and referral.created_at <= campaign.ends_at;

create index referrals_campaign_ranking_idx
  on public.referrals (campaign_id, status, rewarded_at, referrer_user_id);

create unique index referrals_rewarded_device_hash_unique_idx
  on public.referrals (qualification_device_hash)
  where status = 'rewarded' and qualification_device_hash is not null;

create unique index licenses_referral_program_user_unique_idx
  on public.licenses (user_id, source)
  where source = 'referral-program';

create table public.referral_campaign_awards (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.referral_campaigns (id) on delete restrict,
  rank integer not null,
  user_id uuid not null references auth.users (id) on delete restrict,
  plan_code text not null,
  license_id uuid references public.licenses (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint referral_campaign_awards_rank_check check (rank between 1 and 3),
  constraint referral_campaign_awards_plan_check check (plan_code in ('PRO', 'PRO_PLUS', 'FOUNDER')),
  constraint referral_campaign_awards_rank_unique unique (campaign_id, rank),
  constraint referral_campaign_awards_user_unique unique (campaign_id, user_id)
);

alter table public.referral_campaigns enable row level security;
alter table public.referral_campaign_awards enable row level security;

revoke all on table public.referral_campaigns
  from public, anon, authenticated;
revoke all on table public.referral_campaign_awards
  from public, anon, authenticated;
grant all on table public.referral_campaigns to service_role;
grant all on table public.referral_campaign_awards to service_role;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  safe_display_name text;
  submitted_referral_code text;
  selected_referrer_user_id uuid;
  selected_campaign_id uuid;
  profile_created boolean := false;
  attempt integer;
begin
  safe_display_name := nullif(btrim(new.raw_user_meta_data ->> 'display_name'), '');
  submitted_referral_code := upper(
    nullif(btrim(new.raw_user_meta_data ->> 'referral_code'), '')
  );

  if submitted_referral_code ~ '^HUNT-[A-HJ-NP-Z2-9]{8}$' then
    select user_id
    into selected_referrer_user_id
    from public.profiles
    where referral_code = submitted_referral_code;
  end if;

  select id
  into selected_campaign_id
  from public.referral_campaigns
  where status = 'active'
    and new.created_at >= starts_at
    and new.created_at <= ends_at
  order by starts_at desc
  limit 1;

  for attempt in 1..20 loop
    begin
      insert into public.profiles (user_id, display_name, referred_by)
      values (new.id, left(safe_display_name, 100), selected_referrer_user_id);

      profile_created := true;
      exit;
    exception
      when unique_violation then
        if exists (select 1 from public.profiles where user_id = new.id) then
          return new;
        end if;
    end;
  end loop;

  if not profile_created then
    raise exception 'Could not create profile for auth user %', new.id;
  end if;

  if selected_referrer_user_id is not null then
    insert into public.referrals (
      referrer_user_id,
      referred_user_id,
      campaign_id,
      status,
      qualification_reason
    )
    values (
      selected_referrer_user_id,
      new.id,
      selected_campaign_id,
      'pending',
      'awaiting_validation'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated, service_role;

create or replace function public.reconcile_referral_program(
  p_referrer_user_id uuid default null,
  p_limit integer default 250,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  candidate record;
  selected_device_hash text;
  reward_inserted boolean;
  pro_plan_id uuid;
  current_pro_expiry timestamptz;
  checked_count integer := 0;
  rewarded_count integer := 0;
  pending_count integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise invalid_parameter_value using message = 'Referral reconciliation limit is invalid';
  end if;

  select id into pro_plan_id
  from public.plans
  where code = 'PRO' and enabled;

  if pro_plan_id is null then
    raise object_not_in_prerequisite_state using message = 'PRO plan is unavailable';
  end if;

  for candidate in
    select
      referral.id,
      referral.referrer_user_id,
      referral.referred_user_id,
      referral.created_at,
      auth_user.email_confirmed_at
    from public.referrals as referral
    join auth.users as auth_user on auth_user.id = referral.referred_user_id
    where referral.status = 'pending'
      and (p_referrer_user_id is null or referral.referrer_user_id = p_referrer_user_id)
    order by referral.created_at, referral.id
    limit p_limit
  loop
    checked_count := checked_count + 1;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(candidate.id::text, 0)
    );

    if candidate.email_confirmed_at is null then
      update public.referrals
      set qualification_reason = 'awaiting_email_confirmation'
      where id = candidate.id and status = 'pending';
      pending_count := pending_count + 1;
      continue;
    end if;

    if candidate.created_at + interval '24 hours' > p_now then
      update public.referrals
      set qualification_reason = 'awaiting_24h_validation'
      where id = candidate.id and status = 'pending';
      pending_count := pending_count + 1;
      continue;
    end if;

    select device.device_hash
    into selected_device_hash
    from public.devices as device
    where device.user_id = candidate.referred_user_id
      and device.revoked_at is null
      and device.last_seen_at >= candidate.created_at
      and not exists (
        select 1
        from public.devices as referrer_device
        where referrer_device.user_id = candidate.referrer_user_id
          and referrer_device.revoked_at is null
          and referrer_device.device_hash = device.device_hash
      )
      and not exists (
        select 1
        from public.referrals as rewarded_referral
        where rewarded_referral.status = 'rewarded'
          and rewarded_referral.qualification_device_hash = device.device_hash
          and rewarded_referral.id <> candidate.id
      )
    order by device.first_seen_at, device.id
    limit 1;

    if selected_device_hash is null then
      update public.referrals
      set qualification_reason = 'awaiting_unique_device'
      where id = candidate.id and status = 'pending';
      pending_count := pending_count + 1;
      continue;
    end if;

    begin
      update public.referrals
      set
        status = 'qualified',
        qualification_reason = 'email_age_and_unique_device_validated',
        qualification_device_hash = selected_device_hash,
        qualified_at = p_now
      where id = candidate.id and status = 'pending';

      insert into public.referral_rewards (
        referral_id,
        beneficiary_user_id,
        reward_type,
        reward_days,
        metadata
      )
      values (
        candidate.id,
        candidate.referrer_user_id,
        'pro_days',
        1,
        jsonb_build_object('qualification', 'email_age_and_unique_device')
      )
      on conflict (referral_id, beneficiary_user_id, reward_type) do nothing
      returning true into reward_inserted;

      if coalesce(reward_inserted, false) then
        perform pg_catalog.pg_advisory_xact_lock(
          pg_catalog.hashtextextended(candidate.referrer_user_id::text, 1)
        );

        select greatest(
          p_now,
          coalesce(max(license.expires_at), p_now)
        )
        into current_pro_expiry
        from public.licenses as license
        where license.user_id = candidate.referrer_user_id
          and license.plan_id = pro_plan_id
          and license.status = 'active'
          and not license.lifetime
          and license.expires_at > p_now;

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
          candidate.referrer_user_id,
          pro_plan_id,
          'active',
          p_now,
          current_pro_expiry + interval '1 day',
          false,
          'referral-program'
        )
        on conflict (user_id, source) where source = 'referral-program'
        do update set
          status = 'active',
          expires_at = greatest(public.licenses.expires_at, excluded.expires_at),
          updated_at = p_now;
      end if;

      update public.referrals
      set status = 'rewarded', rewarded_at = p_now
      where id = candidate.id and status = 'qualified';

      rewarded_count := rewarded_count + 1;
    exception
      when unique_violation then
        update public.referrals
        set
          status = 'pending',
          qualification_reason = 'awaiting_unique_device',
          qualification_device_hash = null,
          qualified_at = null
        where id = candidate.id and status <> 'rewarded';
        pending_count := pending_count + 1;
    end;
  end loop;

  return jsonb_build_object(
    'checked', checked_count,
    'rewarded', rewarded_count,
    'pending', pending_count
  );
end;
$$;

revoke all on function public.reconcile_referral_program(uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.reconcile_referral_program(uuid, integer, timestamptz)
  to service_role;

create or replace function public.referral_program_dashboard(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  own_profile public.profiles%rowtype;
  selected_campaign public.referral_campaigns%rowtype;
  own_position integer;
  body jsonb;
begin
  if p_user_id is null then
    raise invalid_parameter_value using message = 'User is required';
  end if;

  perform public.reconcile_referral_program(p_user_id, 100, now());

  select * into own_profile
  from public.profiles
  where user_id = p_user_id;

  if not found then
    raise no_data_found using message = 'Profile not found';
  end if;

  select * into selected_campaign
  from public.referral_campaigns
  order by (status = 'active') desc, ends_at desc
  limit 1;

  with ranking as (
    select
      referral.referrer_user_id,
      count(*)::integer as valid_referrals,
      min(referral.rewarded_at) as first_rewarded_at,
      dense_rank() over (
        order by count(*) desc, min(referral.rewarded_at), referral.referrer_user_id
      )::integer as position
    from public.referrals as referral
    where referral.campaign_id = selected_campaign.id
      and referral.status = 'rewarded'
    group by referral.referrer_user_id
  )
  select position into own_position
  from ranking
  where referrer_user_id = p_user_id;

  select jsonb_build_object(
    'code', own_profile.referral_code,
    'share_url', 'https://altgrid.com.br/?ref=' || own_profile.referral_code,
    'campaign', jsonb_build_object(
      'id', selected_campaign.id,
      'name', selected_campaign.name,
      'starts_at', selected_campaign.starts_at,
      'ends_at', selected_campaign.ends_at,
      'status', selected_campaign.status
    ),
    'stats', jsonb_build_object(
      'total', (select count(*) from public.referrals where referrer_user_id = p_user_id),
      'valid', (select count(*) from public.referrals where referrer_user_id = p_user_id and status = 'rewarded'),
      'pending', (select count(*) from public.referrals where referrer_user_id = p_user_id and status in ('pending', 'qualified')),
      'rejected', (select count(*) from public.referrals where referrer_user_id = p_user_id and status = 'rejected'),
      'pro_days', (select coalesce(sum(reward_days), 0) from public.referral_rewards where beneficiary_user_id = p_user_id and reward_type = 'pro_days'),
      'position', own_position
    ),
    'leaderboard', coalesce((
      with ranking as (
        select
          referral.referrer_user_id,
          count(*)::integer as valid_referrals,
          min(referral.rewarded_at) as first_rewarded_at,
          row_number() over (
            order by count(*) desc, min(referral.rewarded_at), referral.referrer_user_id
          )::integer as position
        from public.referrals as referral
        where referral.campaign_id = selected_campaign.id
          and referral.status = 'rewarded'
        group by referral.referrer_user_id
      )
      select jsonb_agg(jsonb_build_object(
        'position', ranking.position,
        'display_name', coalesce(nullif(profile.display_name, ''), 'Membro AltGrid'),
        'valid_referrals', ranking.valid_referrals,
        'prize_plan', case ranking.position
          when 1 then 'FOUNDER'
          when 2 then 'PRO_PLUS'
          when 3 then 'PRO'
          else null
        end,
        'is_current_user', ranking.referrer_user_id = p_user_id
      ) order by ranking.position)
      from ranking
      join public.profiles as profile on profile.user_id = ranking.referrer_user_id
      where ranking.position <= 50
    ), '[]'::jsonb),
    'recent_referrals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'display_name', coalesce(nullif(profile.display_name, ''), 'Novo membro'),
        'status', referral.status,
        'created_at', referral.created_at,
        'rewarded_at', referral.rewarded_at
      ) order by referral.created_at desc)
      from (
        select *
        from public.referrals
        where referrer_user_id = p_user_id
        order by created_at desc
        limit 20
      ) as referral
      join public.profiles as profile on profile.user_id = referral.referred_user_id
    ), '[]'::jsonb)
  ) into body;

  return body;
end;
$$;

revoke all on function public.referral_program_dashboard(uuid)
  from public, anon, authenticated;
grant execute on function public.referral_program_dashboard(uuid)
  to service_role;

create or replace function public.finalize_referral_campaigns(p_now timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  campaign public.referral_campaigns%rowtype;
  winner record;
  selected_plan_id uuid;
  selected_plan_code text;
  selected_license_id uuid;
  selected_founder_number integer;
  finalized_count integer := 0;
  awarded_count integer := 0;
begin
  for campaign in
    select *
    from public.referral_campaigns
    where status = 'active' and ends_at <= p_now
    order by ends_at
    for update
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(campaign.id::text, 2)
    );

    for winner in
      select
        referral.referrer_user_id as user_id,
        count(*)::integer as valid_referrals,
        row_number() over (
          order by count(*) desc, min(referral.rewarded_at), referral.referrer_user_id
        )::integer as position
      from public.referrals as referral
      where referral.campaign_id = campaign.id
        and referral.status = 'rewarded'
      group by referral.referrer_user_id
      order by valid_referrals desc, min(referral.rewarded_at), referral.referrer_user_id
      limit 3
    loop
      selected_plan_code := case winner.position
        when 1 then 'FOUNDER'
        when 2 then 'PRO_PLUS'
        else 'PRO'
      end;
      selected_founder_number := null;
      selected_license_id := null;

      select id into selected_plan_id
      from public.plans
      where code = selected_plan_code and enabled and is_lifetime_available;

      if selected_plan_id is null then
        raise object_not_in_prerequisite_state using message = 'Campaign prize plan is unavailable';
      end if;

      select license.id
      into selected_license_id
      from public.licenses as license
      join public.plans as plan on plan.id = license.plan_id
      where license.user_id = winner.user_id
        and license.status = 'active'
        and license.lifetime
        and plan.entitlement_rank >= (
          select entitlement_rank from public.plans where id = selected_plan_id
        )
      order by plan.entitlement_rank desc, license.created_at
      limit 1;

      if selected_license_id is null then
        if selected_plan_code = 'FOUNDER' then
          select founder_number into selected_founder_number
          from public.licenses
          where user_id = winner.user_id and founder_number is not null
          order by created_at
          limit 1;

          if selected_founder_number is null then
            selected_founder_number := nextval('public.founder_number_seq');
          else
            update public.licenses
            set founder_number = null, updated_at = p_now
            where user_id = winner.user_id
              and founder_number = selected_founder_number;
          end if;
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
          winner.user_id,
          selected_plan_id,
          'active',
          p_now,
          null,
          true,
          selected_founder_number,
          'referral-campaign:' || campaign.id::text || ':rank:' || winner.position::text
        )
        returning id into selected_license_id;
      end if;

      insert into public.referral_campaign_awards (
        campaign_id,
        rank,
        user_id,
        plan_code,
        license_id
      )
      values (
        campaign.id,
        winner.position,
        winner.user_id,
        selected_plan_code,
        selected_license_id
      )
      on conflict (campaign_id, rank) do nothing;

      awarded_count := awarded_count + 1;
    end loop;

    update public.referral_campaigns
    set status = 'finalized', finalized_at = p_now, updated_at = p_now
    where id = campaign.id and status = 'active';
    finalized_count := finalized_count + 1;
  end loop;

  return jsonb_build_object(
    'finalized_campaigns', finalized_count,
    'awards', awarded_count
  );
end;
$$;

revoke all on function public.finalize_referral_campaigns(timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_referral_campaigns(timestamptz)
  to service_role;

commit;
