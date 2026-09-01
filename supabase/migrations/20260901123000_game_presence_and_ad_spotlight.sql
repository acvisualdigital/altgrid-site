begin;

update public.app_ad_plans set description = case code
  when 'sidebar' then 'Cartão patrocinado fixo; jogos aprovados recebem destaque no catálogo do app.'
  when 'spotlight' then 'Vitrine lateral, destaque no catálogo e pop-up controlado para usuários FREE.'
  when 'impact' then 'Maior prioridade na lateral, no catálogo e no pop-up para usuários FREE.'
  else description
end
where code in ('sidebar', 'spotlight', 'impact');

alter table public.profiles
  add column if not exists active_game_slugs text[] not null default '{}'::text[];

comment on column public.profiles.active_game_slugs is
  'Enabled game slugs currently open by the user; used only for aggregate live counters.';

create or replace function public.record_presence(
  p_user_id uuid,
  p_active_game_slugs text[] default '{}'::text[]
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
  set
    last_seen_at = statement_timestamp(),
    active_game_slugs = array(
      select distinct requested.slug
      from unnest(coalesce(p_active_game_slugs, '{}'::text[])) as requested(slug)
      join public.games as game on game.slug = requested.slug and game.enabled = true
      limit 32
    )
  where user_id = p_user_id;
$$;

create or replace function public.app_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  generated_at constant timestamptz := statement_timestamp();
begin
  return jsonb_build_object(
    'users', jsonb_build_object(
      'active', (
        select count(*) from public.profiles as profile
        where profile.last_seen_at >= generated_at - interval '15 minutes'
      ),
      'total', (select count(*) from public.profiles)
    ),
    'games', coalesce((
      select jsonb_object_agg(summary.slug, summary.active_users)
      from (
        select game.slug, count(distinct profile.user_id) filter (
          where profile.last_seen_at >= generated_at - interval '15 minutes'
        ) as active_users
        from public.games as game
        left join public.profiles as profile
          on game.slug = any(profile.active_game_slugs)
        where game.enabled = true
        group by game.slug
      ) as summary
    ), '{}'::jsonb),
    'active_window_seconds', 900,
    'generated_at', generated_at
  );
end;
$$;

revoke all on function public.record_presence(uuid, text[]) from public, anon, authenticated;
grant execute on function public.record_presence(uuid, text[]) to service_role;

alter table public.app_ad_requests
  add column if not exists game_slug text references public.games (slug) on update cascade on delete set null,
  add column if not exists catalog_game_name text,
  add column if not exists catalog_launch_url text,
  add column if not exists catalog_icon_url text;

alter table public.app_ad_requests
  drop constraint if exists app_ad_requests_game_target_check;
alter table public.app_ad_requests
  add constraint app_ad_requests_game_target_check check (
    category <> 'game'
    or game_slug is not null
    or (
      length(btrim(catalog_game_name)) between 2 and 80
      and catalog_launch_url ~* '^https://'
      and catalog_icon_url ~* '^https://'
    )
  ) not valid;

drop function if exists public.create_app_ad_request(uuid, text, text, text, text, text, text, text, text, integer);
drop function if exists public.create_app_ad_request(uuid, text, text, text, text, text, text, text, text, text, text, text, text, integer);

create function public.create_app_ad_request(
  p_user_id uuid,
  p_plan_code text,
  p_category text,
  p_game_slug text,
  p_catalog_game_name text,
  p_catalog_launch_url text,
  p_catalog_icon_url text,
  p_advertiser_name text,
  p_title text,
  p_description text,
  p_destination_url text,
  p_image_url text,
  p_cta_label text,
  p_requested_days integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  selected_plan public.app_ad_plans%rowtype;
  created_request public.app_ad_requests%rowtype;
begin
  select * into selected_plan from public.app_ad_plans
  where code = p_plan_code and enabled = true;
  if selected_plan.code is null then
    raise exception 'advertising plan unavailable' using errcode = 'P0002';
  end if;
  if p_requested_days not between selected_plan.min_days and selected_plan.max_days then
    raise exception 'requested duration outside plan limits' using errcode = '22023';
  end if;

  insert into public.app_ad_requests (
    user_id, plan_code, category, game_slug, catalog_game_name, catalog_launch_url,
    catalog_icon_url, advertiser_name, title, description, destination_url,
    image_url, cta_label, requested_days, quoted_amount, currency
  ) values (
    p_user_id, selected_plan.code, p_category,
    nullif(btrim(coalesce(p_game_slug, '')), ''),
    nullif(btrim(coalesce(p_catalog_game_name, '')), ''),
    nullif(btrim(coalesce(p_catalog_launch_url, '')), ''),
    nullif(btrim(coalesce(p_catalog_icon_url, '')), ''),
    btrim(p_advertiser_name), btrim(p_title), btrim(p_description),
    btrim(p_destination_url), nullif(btrim(coalesce(p_image_url, '')), ''),
    btrim(p_cta_label), p_requested_days,
    round(selected_plan.price_per_day * p_requested_days, 2), selected_plan.currency
  ) returning * into created_request;

  return jsonb_build_object(
    'id', created_request.id,
    'status', created_request.status,
    'plan_code', created_request.plan_code,
    'requested_days', created_request.requested_days,
    'quoted_amount', created_request.quoted_amount,
    'currency', created_request.currency,
    'created_at', created_request.created_at
  );
end;
$$;

revoke all on function public.create_app_ad_request(uuid, text, text, text, text, text, text, text, text, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.create_app_ad_request(uuid, text, text, text, text, text, text, text, text, text, text, text, text, integer) to service_role;

drop function if exists public.admin_list_app_ad_requests(uuid, text);
create function public.admin_list_app_ad_requests(
  p_actor_user_id uuid,
  p_status text default null
)
returns table (
  id uuid, user_id uuid, user_email text, display_name text,
  plan_code text, plan_name text, category text, game_slug text,
  catalog_game_name text, catalog_launch_url text, catalog_icon_url text,
  advertiser_name text, title text, description text, destination_url text,
  image_url text, cta_label text, requested_days integer, quoted_amount numeric,
  currency text, status text, admin_notes text, reviewed_by uuid,
  reviewed_at timestamptz, starts_at timestamptz, ends_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_assert_actor(p_actor_user_id);
  if p_status is not null and p_status not in ('pending', 'reviewing', 'approved', 'rejected', 'cancelled') then
    raise exception 'invalid advertising status' using errcode = '22023';
  end if;
  return query
  select request.id, request.user_id, account.email::text, profile.display_name,
    request.plan_code, plan.name, request.category, request.game_slug,
    request.catalog_game_name, request.catalog_launch_url, request.catalog_icon_url,
    request.advertiser_name, request.title, request.description,
    request.destination_url, request.image_url, request.cta_label,
    request.requested_days, request.quoted_amount, request.currency, request.status,
    request.admin_notes, request.reviewed_by, request.reviewed_at,
    request.starts_at, request.ends_at, request.created_at, request.updated_at
  from public.app_ad_requests as request
  join public.app_ad_plans as plan on plan.code = request.plan_code
  left join auth.users as account on account.id = request.user_id
  left join public.profiles as profile on profile.user_id = request.user_id
  where p_status is null or request.status = p_status
  order by case request.status when 'pending' then 0 when 'reviewing' then 1 else 2 end,
    request.created_at desc
  limit 250;
end;
$$;

revoke all on function public.admin_list_app_ad_requests(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_list_app_ad_requests(uuid, text) to service_role;

commit;
