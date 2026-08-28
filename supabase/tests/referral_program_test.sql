begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

select has_table('public', 'referral_campaigns', 'campaign table exists');
select has_table('public', 'referral_campaign_awards', 'campaign awards table exists');
select has_function(
  'public',
  'reconcile_referral_program',
  array['uuid', 'integer', 'timestamp with time zone'],
  'secure referral reconciliation exists'
);

insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
)
values (
  'f0000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'referrer-integrity@altgrid.invalid',
  '2026-08-28 04:00:00+00',
  '{}'::jsonb,
  jsonb_build_object('display_name', 'Referrer Test'),
  '2026-08-28 04:00:00+00',
  '2026-08-28 04:00:00+00'
);

insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
)
select
  'f0000000-0000-4000-8000-000000000002',
  'authenticated',
  'authenticated',
  'referred-one-integrity@altgrid.invalid',
  '2026-08-28 05:00:00+00',
  '{}'::jsonb,
  jsonb_build_object(
    'display_name', 'Referred One',
    'referral_code', profile.referral_code
  ),
  '2026-08-28 05:00:00+00',
  '2026-08-28 05:00:00+00'
from public.profiles as profile
where profile.user_id = 'f0000000-0000-4000-8000-000000000001';

select is(
  (select count(*)::integer from public.referrals
    where referred_user_id = 'f0000000-0000-4000-8000-000000000002'),
  1,
  'signup metadata creates exactly one pending referral'
);

insert into public.devices (
  user_id, device_hash, platform, first_seen_at, last_seen_at
)
values (
  'f0000000-0000-4000-8000-000000000002',
  repeat('a', 64),
  'integrity-test',
  '2026-08-28 06:00:00+00',
  '2026-08-28 06:00:00+00'
);

select public.reconcile_referral_program(
  'f0000000-0000-4000-8000-000000000001',
  100,
  '2026-08-29 07:00:00+00'
);

select is(
  (select status from public.referrals
    where referred_user_id = 'f0000000-0000-4000-8000-000000000002'),
  'rewarded',
  'confirmed account older than 24h on a unique device is rewarded'
);
select is(
  (select count(*)::integer from public.referral_rewards
    where beneficiary_user_id = 'f0000000-0000-4000-8000-000000000001'),
  1,
  'one valid referral creates exactly one reward ledger entry'
);
select is(
  (select count(*)::integer from public.licenses
    where user_id = 'f0000000-0000-4000-8000-000000000001'
      and source = 'referral-program'),
  1,
  'reward creates one aggregate PRO license'
);

select public.reconcile_referral_program(
  'f0000000-0000-4000-8000-000000000001',
  100,
  '2026-08-29 08:00:00+00'
);

select is(
  (select count(*)::integer from public.referral_rewards
    where beneficiary_user_id = 'f0000000-0000-4000-8000-000000000001'),
  1,
  'reconciliation is idempotent and cannot duplicate a reward'
);

insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at
)
select
  'f0000000-0000-4000-8000-000000000003',
  'authenticated',
  'authenticated',
  'referred-two-integrity@altgrid.invalid',
  '2026-08-28 05:30:00+00',
  '{}'::jsonb,
  jsonb_build_object(
    'display_name', 'Referred Two',
    'referral_code', profile.referral_code
  ),
  '2026-08-28 05:30:00+00',
  '2026-08-28 05:30:00+00'
from public.profiles as profile
where profile.user_id = 'f0000000-0000-4000-8000-000000000001';

insert into public.devices (
  user_id, device_hash, platform, first_seen_at, last_seen_at
)
values (
  'f0000000-0000-4000-8000-000000000003',
  repeat('a', 64),
  'integrity-test',
  '2026-08-28 06:30:00+00',
  '2026-08-28 06:30:00+00'
);

select public.reconcile_referral_program(
  'f0000000-0000-4000-8000-000000000001',
  100,
  '2026-08-29 08:00:00+00'
);

select is(
  (select status from public.referrals
    where referred_user_id = 'f0000000-0000-4000-8000-000000000003'),
  'pending',
  'a device already used by a rewarded referral cannot qualify again'
);
select is(
  (select qualification_reason from public.referrals
    where referred_user_id = 'f0000000-0000-4000-8000-000000000003'),
  'awaiting_unique_device',
  'duplicate device is recorded without leaking a reward'
);
select is(
  (select count(*)::integer from public.referral_rewards
    where beneficiary_user_id = 'f0000000-0000-4000-8000-000000000001'),
  1,
  'duplicate-device attempt leaves total reward unchanged'
);

select throws_ok(
  $$update public.profiles
    set referred_by = user_id
    where user_id = 'f0000000-0000-4000-8000-000000000001'$$,
  '23514',
  null,
  'self-referral is rejected by a database constraint'
);

select is(
  (public.referral_program_dashboard(
    'f0000000-0000-4000-8000-000000000001'
  ) -> 'stats' ->> 'valid')::integer,
  1,
  'dashboard counts only validated referrals'
);

select * from finish();
rollback;
