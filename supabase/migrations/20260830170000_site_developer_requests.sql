create table public.site_developer_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  request_type text not null,
  game_slug text,
  plan_code text,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  admin_notes text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  campaign_starts_at timestamptz,
  campaign_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_developer_requests_type_check
    check (request_type in ('register', 'claim', 'campaign')),
  constraint site_developer_requests_status_check
    check (status in ('pending', 'reviewing', 'approved', 'rejected', 'cancelled')),
  constraint site_developer_requests_plan_check
    check (plan_code is null or plan_code in ('highlight_7', 'launch_30')),
  constraint site_developer_requests_payload_check
    check (jsonb_typeof(payload) = 'object'),
  constraint site_developer_requests_shape_check check (
    (request_type = 'register' and game_slug is null and plan_code is null)
    or (request_type = 'claim' and game_slug is not null and plan_code is null)
    or (request_type = 'campaign' and game_slug is not null and plan_code is not null)
  ),
  constraint site_developer_requests_review_check check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or status <> 'pending'
  )
);

create index site_developer_requests_user_created_idx
  on public.site_developer_requests (user_id, created_at desc);

create index site_developer_requests_admin_queue_idx
  on public.site_developer_requests (status, created_at)
  where status in ('pending', 'reviewing');

create unique index site_developer_requests_active_claim_idx
  on public.site_developer_requests (user_id, game_slug)
  where request_type = 'claim' and status in ('pending', 'reviewing', 'approved');

create trigger site_developer_requests_set_updated_at
before update on public.site_developer_requests
for each row execute function public.set_updated_at();

alter table public.site_developer_requests enable row level security;

revoke all on table public.site_developer_requests from anon, authenticated;

grant select, insert, update, delete
on table public.site_developer_requests
to service_role;

grant select, insert
on table public.site_developer_requests
to authenticated;

create policy site_developer_requests_read_own
on public.site_developer_requests
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy site_developer_requests_insert_own
on public.site_developer_requests
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and status = 'pending'
  and reviewed_by is null
  and reviewed_at is null
  and admin_notes is null
);

comment on table public.site_developer_requests is
  'Solicitações autenticadas de cadastro, reivindicação e campanhas enviadas pelo catálogo público.';

comment on column public.site_developer_requests.plan_code is
  'Plano solicitado. Preços são definidos no servidor/admin e nunca confiados ao payload do cliente.';

create or replace function public.get_active_site_spotlight()
returns table (
  id uuid,
  game_slug text,
  plan_code text,
  payload jsonb,
  campaign_starts_at timestamptz,
  campaign_ends_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    request.id,
    request.game_slug,
    request.plan_code,
    jsonb_build_object(
      'banner_url', request.payload ->> 'banner_url',
      'headline', request.payload ->> 'headline',
      'ad_description', request.payload ->> 'ad_description',
      'cta_label', request.payload ->> 'cta_label'
    ),
    request.campaign_starts_at,
    request.campaign_ends_at
  from public.site_developer_requests as request
  where request.request_type = 'campaign'
    and request.status = 'approved'
    and request.campaign_starts_at <= now()
    and request.campaign_ends_at > now()
  order by request.campaign_starts_at desc, request.reviewed_at desc
  limit 1;
$$;

revoke all on function public.get_active_site_spotlight() from public;
grant execute on function public.get_active_site_spotlight() to anon, authenticated, service_role;

comment on function public.get_active_site_spotlight() is
  'Expõe somente os campos públicos e sanitizados da campanha aprovada atualmente no Holofote AltGrid.';

create or replace function public.admin_list_site_developer_requests(
  p_actor_user_id uuid,
  p_status text default null
)
returns table (
  id uuid,
  user_id uuid,
  user_email text,
  display_name text,
  request_type text,
  game_slug text,
  plan_code text,
  status text,
  payload jsonb,
  admin_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  campaign_starts_at timestamptz,
  campaign_ends_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_assert_actor(p_actor_user_id);
  if p_status is not null and p_status not in ('pending', 'reviewing', 'approved', 'rejected', 'cancelled') then
    raise exception 'invalid publisher request status' using errcode = '22023';
  end if;
  return query
  select entry.id, entry.user_id, account.email::text, profile.display_name,
    entry.request_type, entry.game_slug, entry.plan_code, entry.status, entry.payload,
    entry.admin_notes, entry.reviewed_by, entry.reviewed_at,
    entry.campaign_starts_at, entry.campaign_ends_at, entry.created_at, entry.updated_at
  from public.site_developer_requests as entry
  left join auth.users as account on account.id = entry.user_id
  left join public.profiles as profile on profile.user_id = entry.user_id
  where p_status is null or entry.status = p_status
  order by case when entry.status = 'pending' then 0 when entry.status = 'reviewing' then 1 else 2 end,
    entry.created_at desc
  limit 250;
end;
$$;

create or replace function public.admin_review_site_developer_request(
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
  before_row public.site_developer_requests%rowtype;
  after_row public.site_developer_requests%rowtype;
  requested_start timestamptz;
  duration_days integer;
begin
  perform public.admin_assert_actor(p_actor_user_id);
  if p_status not in ('reviewing', 'approved', 'rejected') then
    raise exception 'invalid publisher review status' using errcode = '22023';
  end if;
  if length(coalesce(p_notes, '')) > 2000 then
    raise exception 'publisher review notes too long' using errcode = '22023';
  end if;

  select * into before_row from public.site_developer_requests where id = p_request_id for update;
  if before_row.id is null then raise exception 'publisher request not found' using errcode = 'P0002'; end if;

  if before_row.request_type = 'campaign' and p_status = 'approved' then
    if coalesce(before_row.payload ->> 'banner_url', '') !~* '^https://'
      or length(btrim(coalesce(before_row.payload ->> 'headline', ''))) not between 3 and 80
      or length(btrim(coalesce(before_row.payload ->> 'ad_description', ''))) not between 10 and 180
      or length(btrim(coalesce(before_row.payload ->> 'cta_label', ''))) not between 2 and 28 then
      raise exception 'campaign creative is incomplete or unsafe' using errcode = '22023';
    end if;
    requested_start := greatest(
      now(),
      case
        when coalesce(before_row.payload ->> 'starts_on', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          then (before_row.payload ->> 'starts_on')::date::timestamptz
        else now()
      end
    );
    duration_days := case before_row.plan_code when 'launch_30' then 30 else 7 end;
  end if;

  update public.site_developer_requests
  set status = p_status,
      admin_notes = nullif(btrim(coalesce(p_notes, '')), ''),
      reviewed_by = p_actor_user_id,
      reviewed_at = now(),
      campaign_starts_at = case when request_type = 'campaign' and p_status = 'approved' then requested_start else null end,
      campaign_ends_at = case when request_type = 'campaign' and p_status = 'approved' then requested_start + make_interval(days => duration_days) else null end
  where id = p_request_id
  returning * into after_row;

  perform public.admin_write_audit(
    p_actor_user_id,
    'site.publisher_request.' || p_status,
    'site_developer_request',
    p_request_id::text,
    to_jsonb(before_row),
    to_jsonb(after_row)
  );

  return to_jsonb(after_row);
end;
$$;

revoke all on function public.admin_list_site_developer_requests(uuid, text) from public, anon, authenticated;
revoke all on function public.admin_review_site_developer_request(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_list_site_developer_requests(uuid, text) to service_role;
grant execute on function public.admin_review_site_developer_request(uuid, uuid, text, text) to service_role;
