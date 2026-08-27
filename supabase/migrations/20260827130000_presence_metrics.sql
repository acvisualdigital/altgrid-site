begin;

alter table public.profiles
  add column last_seen_at timestamptz;

comment on column public.profiles.last_seen_at is
  'Server-recorded timestamp of the latest authenticated presence heartbeat.';

create index profiles_last_seen_at_idx
  on public.profiles (last_seen_at desc)
  where last_seen_at is not null;

create or replace function public.record_presence(p_user_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
  set last_seen_at = statement_timestamp()
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
  return (
    select jsonb_build_object(
      'users', jsonb_build_object(
        'active', count(*) filter (
          where profile.last_seen_at >= generated_at - interval '15 minutes'
        ),
        'total', count(*)
      ),
      'active_window_seconds', 900,
      'generated_at', generated_at
    )
    from public.profiles as profile
  );
end;
$$;

revoke all on function public.record_presence(uuid)
  from public, anon, authenticated;
revoke all on function public.app_metrics()
  from public, anon, authenticated;

grant execute on function public.record_presence(uuid) to service_role;
grant execute on function public.app_metrics() to service_role;

commit;
