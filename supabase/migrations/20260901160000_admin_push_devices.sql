create table if not exists public.admin_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique check (char_length(token) between 20 and 4096),
  platform text not null check (platform in ('android')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.admin_push_devices enable row level security;

revoke all on table public.admin_push_devices from anon, authenticated;

create index if not exists admin_push_devices_active_idx
  on public.admin_push_devices (enabled, user_id);

comment on table public.admin_push_devices is
  'FCM registration tokens accepted only through the server-side admin API.';
