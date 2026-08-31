begin;

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
      or coalesce(profile.display_name, '') ilike '%' || normalized_query || '%'
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

comment on function public.admin_search_users(uuid, text, integer, integer) is
  'Admin-only paginated user search by email, nickname, user id, or referral code.';

commit;
