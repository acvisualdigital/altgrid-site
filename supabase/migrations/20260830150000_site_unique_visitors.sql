begin;

create table if not exists public.site_visitors (
  visitor_id uuid primary key,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  visit_count bigint not null default 1 check (visit_count > 0)
);

alter table public.site_visitors enable row level security;
revoke all on table public.site_visitors from anon, authenticated;

create or replace function public.register_site_visit(p_visitor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_unique_visitors bigint;
begin
  if p_visitor_id is null then
    raise exception 'visitor_id is required';
  end if;

  insert into public.site_visitors (visitor_id)
  values (p_visitor_id)
  on conflict (visitor_id) do update
  set last_seen_at = now(),
      visit_count = public.site_visitors.visit_count + 1;

  select count(*) into v_unique_visitors from public.site_visitors;

  return jsonb_build_object('unique_visitors', v_unique_visitors);
end;
$$;

revoke all on function public.register_site_visit(uuid) from public;
grant execute on function public.register_site_visit(uuid) to anon, authenticated;

commit;
