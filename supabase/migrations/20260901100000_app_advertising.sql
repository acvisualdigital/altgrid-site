create table public.app_ad_plans (
  code text primary key,
  name text not null,
  description text not null,
  placement text not null,
  min_days integer not null,
  max_days integer not null,
  price_per_day numeric(10, 2) not null,
  currency text not null default 'BRL',
  popup_enabled boolean not null default false,
  priority integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_ad_plans_code_check check (code ~ '^[a-z][a-z0-9_]{2,31}$'),
  constraint app_ad_plans_name_check check (length(btrim(name)) between 2 and 60),
  constraint app_ad_plans_description_check check (length(btrim(description)) between 10 and 180),
  constraint app_ad_plans_placement_check check (placement in ('sidebar', 'sidebar_popup')),
  constraint app_ad_plans_days_check check (min_days between 1 and 365 and max_days between min_days and 365),
  constraint app_ad_plans_price_check check (price_per_day > 0),
  constraint app_ad_plans_currency_check check (currency ~ '^[A-Z]{3}$')
);

insert into public.app_ad_plans (
  code, name, description, placement, min_days, max_days,
  price_per_day, currency, popup_enabled, priority
)
values
  ('sidebar', 'Vitrine lateral', 'Cartão patrocinado fixo; jogos aprovados recebem destaque no catálogo do app.', 'sidebar', 7, 90, 3.00, 'BRL', false, 10),
  ('spotlight', 'Destaque FREE', 'Vitrine lateral, destaque no catálogo e pop-up controlado para usuários FREE.', 'sidebar_popup', 7, 60, 5.00, 'BRL', true, 20),
  ('impact', 'Campanha impacto', 'Maior prioridade na lateral, no catálogo e no pop-up para usuários FREE.', 'sidebar_popup', 7, 30, 8.00, 'BRL', true, 30)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  placement = excluded.placement,
  min_days = excluded.min_days,
  max_days = excluded.max_days,
  price_per_day = excluded.price_per_day,
  currency = excluded.currency,
  popup_enabled = excluded.popup_enabled,
  priority = excluded.priority,
  enabled = true,
  updated_at = now();

create trigger app_ad_plans_set_updated_at
before update on public.app_ad_plans
for each row execute function public.set_updated_at();

create table public.app_ad_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  plan_code text not null references public.app_ad_plans (code) on update cascade on delete restrict,
  category text not null,
  game_slug text references public.games (slug) on update cascade on delete set null,
  catalog_game_name text,
  catalog_launch_url text,
  catalog_icon_url text,
  advertiser_name text not null,
  title text not null,
  description text not null,
  destination_url text not null,
  image_url text,
  cta_label text not null default 'Saiba mais',
  requested_days integer not null,
  quoted_amount numeric(10, 2) not null,
  currency text not null,
  status text not null default 'pending',
  admin_notes text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_ad_requests_category_check check (category in ('game', 'product', 'site')),
  constraint app_ad_requests_game_target_check check (
    category <> 'game'
    or game_slug is not null
    or (
      length(btrim(catalog_game_name)) between 2 and 80
      and catalog_launch_url ~* '^https://'
      and catalog_icon_url ~* '^https://'
    )
  ),
  constraint app_ad_requests_advertiser_check check (length(btrim(advertiser_name)) between 2 and 80),
  constraint app_ad_requests_title_check check (length(btrim(title)) between 3 and 70),
  constraint app_ad_requests_description_check check (length(btrim(description)) between 10 and 180),
  constraint app_ad_requests_destination_check check (destination_url ~* '^https://'),
  constraint app_ad_requests_image_check check (image_url is null or image_url ~* '^https://'),
  constraint app_ad_requests_cta_check check (length(btrim(cta_label)) between 2 and 24),
  constraint app_ad_requests_days_check check (requested_days between 1 and 365),
  constraint app_ad_requests_quote_check check (quoted_amount > 0 and currency ~ '^[A-Z]{3}$'),
  constraint app_ad_requests_status_check check (status in ('pending', 'reviewing', 'approved', 'rejected', 'cancelled')),
  constraint app_ad_requests_schedule_check check (
    (status = 'approved' and starts_at is not null and ends_at > starts_at)
    or (status <> 'approved' and starts_at is null and ends_at is null)
  )
);

create index app_ad_requests_user_created_idx on public.app_ad_requests (user_id, created_at desc);
create index app_ad_requests_admin_queue_idx on public.app_ad_requests (status, created_at)
where status in ('pending', 'reviewing');
create index app_ad_requests_active_idx on public.app_ad_requests (starts_at, ends_at)
where status = 'approved';

create trigger app_ad_requests_set_updated_at
before update on public.app_ad_requests
for each row execute function public.set_updated_at();

create table public.app_ad_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.app_ad_requests (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  placement text not null,
  created_at timestamptz not null default now(),
  constraint app_ad_events_type_check check (event_type in ('impression', 'click', 'dismiss')),
  constraint app_ad_events_placement_check check (placement in ('sidebar', 'popup'))
);

create index app_ad_events_campaign_created_idx on public.app_ad_events (campaign_id, created_at desc);

alter table public.app_ad_plans enable row level security;
alter table public.app_ad_requests enable row level security;
alter table public.app_ad_events enable row level security;

revoke all on table public.app_ad_plans, public.app_ad_requests, public.app_ad_events from anon, authenticated;
grant select, insert, update, delete on table public.app_ad_plans, public.app_ad_requests, public.app_ad_events to service_role;

create or replace function public.create_app_ad_request(
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
  select * into selected_plan
  from public.app_ad_plans
  where code = p_plan_code and enabled = true;
  if selected_plan.code is null then
    raise exception 'advertising plan unavailable' using errcode = 'P0002';
  end if;
  if p_requested_days not between selected_plan.min_days and selected_plan.max_days then
    raise exception 'requested duration outside plan limits' using errcode = '22023';
  end if;

  insert into public.app_ad_requests (
    user_id, plan_code, category, game_slug, catalog_game_name, catalog_launch_url,
    catalog_icon_url, advertiser_name, title, description,
    destination_url, image_url, cta_label, requested_days, quoted_amount, currency
  ) values (
    p_user_id, selected_plan.code, p_category, nullif(btrim(coalesce(p_game_slug, '')), ''),
    nullif(btrim(coalesce(p_catalog_game_name, '')), ''),
    nullif(btrim(coalesce(p_catalog_launch_url, '')), ''),
    nullif(btrim(coalesce(p_catalog_icon_url, '')), ''),
    btrim(p_advertiser_name), btrim(p_title),
    btrim(p_description), btrim(p_destination_url), nullif(btrim(coalesce(p_image_url, '')), ''),
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

create or replace function public.record_app_ad_event(
  p_user_id uuid,
  p_campaign_id uuid,
  p_event_type text,
  p_placement text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_event_type not in ('impression', 'click', 'dismiss')
    or p_placement not in ('sidebar', 'popup') then
    raise exception 'invalid advertising event' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.app_ad_requests
    where id = p_campaign_id
      and status = 'approved'
      and starts_at <= now()
      and ends_at > now()
  ) then
    raise exception 'advertising campaign is not active' using errcode = 'P0002';
  end if;

  insert into public.app_ad_events (campaign_id, user_id, event_type, placement)
  values (p_campaign_id, p_user_id, p_event_type, p_placement);
end;
$$;

revoke all on function public.record_app_ad_event(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_app_ad_event(uuid, uuid, text, text) to service_role;

create or replace function public.admin_list_app_ad_requests(
  p_actor_user_id uuid,
  p_status text default null
)
returns table (
  id uuid, user_id uuid, user_email text, display_name text,
  plan_code text, plan_name text, category text, game_slug text,
  catalog_game_name text, catalog_launch_url text, catalog_icon_url text, advertiser_name text,
  title text, description text, destination_url text, image_url text,
  cta_label text, requested_days integer, quoted_amount numeric,
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
    request.advertiser_name,
    request.title, request.description, request.destination_url, request.image_url,
    request.cta_label, request.requested_days, request.quoted_amount,
    request.currency, request.status, request.admin_notes, request.reviewed_by,
    request.reviewed_at, request.starts_at, request.ends_at,
    request.created_at, request.updated_at
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

create or replace function public.admin_review_app_ad_request(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  before_row public.app_ad_requests%rowtype;
  after_row public.app_ad_requests%rowtype;
begin
  perform public.admin_assert_actor(p_actor_user_id);
  if p_status not in ('reviewing', 'approved', 'rejected') then
    raise exception 'invalid advertising review status' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 2000 then
    raise exception 'advertising review notes too long' using errcode = '22023';
  end if;

  select * into before_row from public.app_ad_requests where id = p_request_id for update;
  if before_row.id is null then raise exception 'advertising request not found' using errcode = 'P0002'; end if;

  update public.app_ad_requests set
    status = p_status,
    admin_notes = nullif(btrim(coalesce(p_notes, '')), ''),
    reviewed_by = p_actor_user_id,
    reviewed_at = now(),
    starts_at = case when p_status = 'approved' then now() else null end,
    ends_at = case when p_status = 'approved' then now() + make_interval(days => requested_days) else null end
  where id = p_request_id
  returning * into after_row;

  perform public.admin_write_audit(
    p_actor_user_id,
    'app.advertising.' || p_status,
    'app_ad_request',
    p_request_id::text,
    to_jsonb(before_row),
    to_jsonb(after_row)
  );
  return to_jsonb(after_row);
end;
$$;

revoke all on function public.admin_list_app_ad_requests(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_review_app_ad_request(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_list_app_ad_requests(uuid, text) to service_role;
grant execute on function public.admin_review_app_ad_request(uuid, uuid, text, text) to service_role;

comment on table public.app_ad_requests is
  'Solicitações de anúncios no aplicativo. Preço e duração são validados no servidor; somente campanhas aprovadas são exibidas.';
