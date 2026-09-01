-- A private conversation can be cleared/hidden independently by each member.
-- New messages make it visible again without restoring messages cleared earlier.

create table public.chat_direct_user_state (
  channel_id uuid not null references public.chat_direct_pairs(channel_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  hidden_at timestamptz,
  cleared_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (channel_id, user_id),
  constraint chat_direct_user_state_order check (
    hidden_at is null or cleared_at is null or hidden_at >= cleared_at
  )
);

create index chat_direct_user_state_user_idx
  on public.chat_direct_user_state (user_id, hidden_at desc);

alter table public.chat_direct_user_state enable row level security;
revoke all on table public.chat_direct_user_state from public, anon, authenticated;
grant select, insert, update, delete on table public.chat_direct_user_state to service_role;
