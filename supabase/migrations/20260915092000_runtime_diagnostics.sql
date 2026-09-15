-- Latest numeric snapshot only: no chat, game identifiers, cookies or credentials.
create table public.runtime_diagnostics (
  user_id uuid primary key references auth.users(id) on delete cascade,
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 4096),
  received_at timestamptz not null default now()
);
alter table public.runtime_diagnostics enable row level security;
revoke all on public.runtime_diagnostics from public, anon, authenticated;
grant select, insert, update, delete on public.runtime_diagnostics to service_role;

create function public.record_runtime_diagnostics(p_user_id uuid, p_summary jsonb)
returns void language sql security invoker set search_path = '' as $$
  insert into public.runtime_diagnostics(user_id, summary, received_at)
  values (p_user_id, p_summary, now())
  on conflict (user_id) do update set summary = excluded.summary, received_at = excluded.received_at
  where public.runtime_diagnostics.received_at <= now() - interval '15 seconds';
$$;

create function public.get_runtime_diagnostics(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select summary || jsonb_build_object('receivedAt', received_at)
  from public.runtime_diagnostics where user_id = p_user_id;
$$;

revoke all on function public.record_runtime_diagnostics(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.get_runtime_diagnostics(uuid) from public, anon, authenticated;
grant execute on function public.record_runtime_diagnostics(uuid,jsonb) to service_role;
grant execute on function public.get_runtime_diagnostics(uuid) to service_role;
