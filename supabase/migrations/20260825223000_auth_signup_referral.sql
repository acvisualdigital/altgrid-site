begin;

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

  for attempt in 1..20 loop
    begin
      insert into public.profiles (user_id, display_name, referred_by)
      values (new.id, left(safe_display_name, 100), selected_referrer_user_id);

      profile_created := true;
      exit;
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

  if not profile_created then
    raise exception 'Could not create profile for auth user %', new.id;
  end if;

  if selected_referrer_user_id is not null then
    insert into public.referrals (
      referrer_user_id,
      referred_user_id,
      status
    )
    values (
      selected_referrer_user_id,
      new.id,
      'pending'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_auth_user()
  from public, anon, authenticated;

commit;
