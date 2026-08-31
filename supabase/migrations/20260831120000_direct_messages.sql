-- Private one-to-one conversations reuse the existing moderated chat messages.
-- The channel stays hidden from everyone except its two participants.

alter table public.chat_channels
  drop constraint chat_channels_type_check,
  drop constraint chat_channels_game_check;

alter table public.chat_channels
  add constraint chat_channels_type_check
    check (type in ('global', 'game', 'direct')),
  add constraint chat_channels_game_check check (
    (type = 'global' and game_id is null)
    or (type = 'game' and game_id is not null)
    or (type = 'direct' and game_id is null)
  );

create table public.chat_direct_pairs (
  channel_id uuid primary key references public.chat_channels (id) on delete cascade,
  user_low uuid not null references auth.users (id) on delete cascade,
  user_high uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint chat_direct_pairs_distinct_users check (user_low <> user_high),
  constraint chat_direct_pairs_ordered_users check (user_low::text < user_high::text),
  constraint chat_direct_pairs_unique_users unique (user_low, user_high)
);

create index chat_direct_pairs_user_low_idx on public.chat_direct_pairs (user_low);
create index chat_direct_pairs_user_high_idx on public.chat_direct_pairs (user_high);

create table public.chat_direct_reads (
  channel_id uuid not null references public.chat_channels (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (channel_id, user_id)
);

alter table public.chat_direct_pairs enable row level security;
alter table public.chat_direct_reads enable row level security;

revoke all on table public.chat_direct_pairs from public, anon, authenticated;
revoke all on table public.chat_direct_reads from public, anon, authenticated;
grant select, insert, update, delete on table public.chat_direct_pairs to service_role;
grant select, insert, update, delete on table public.chat_direct_reads to service_role;
grant select (channel_id, user_low, user_high) on table public.chat_direct_pairs to authenticated;

create policy chat_direct_pairs_member_read
on public.chat_direct_pairs
for select
to authenticated
using (auth.uid() = user_low or auth.uid() = user_high);

drop policy chat_channels_authenticated_read on public.chat_channels;
create policy chat_channels_authenticated_read
on public.chat_channels
for select
to authenticated
using (
  enabled
  and (
    type <> 'direct'
    or exists (
      select 1
      from public.chat_direct_pairs direct_pair
      where direct_pair.channel_id = chat_channels.id
        and (direct_pair.user_low = auth.uid() or direct_pair.user_high = auth.uid())
    )
  )
);

drop policy chat_messages_authenticated_read on public.chat_messages;
create policy chat_messages_authenticated_read
on public.chat_messages
for select
to authenticated
using (
  deleted_at is null
  and exists (
    select 1
    from public.chat_channels channel_record
    where channel_record.id = chat_messages.channel_id
      and channel_record.enabled
      and (
        channel_record.type <> 'direct'
        or exists (
          select 1
          from public.chat_direct_pairs direct_pair
          where direct_pair.channel_id = channel_record.id
            and (
              direct_pair.user_low = auth.uid()
              or direct_pair.user_high = auth.uid()
            )
        )
      )
  )
);

create or replace function public.chat_list_direct_channels(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', channel_record.id,
        'type', 'direct',
        'game_id', null,
        'name', coalesce(nullif(btrim(partner_profile.display_name), ''), 'Jogador'),
        'participant_id', partner.partner_id,
        'participant_plan', coalesce(partner_access.plan_code, 'FREE'),
        'participant_founder_number', partner_access.founder_number,
        'unread', (
          select count(*)::integer
          from public.chat_messages unread_message
          where unread_message.channel_id = channel_record.id
            and unread_message.deleted_at is null
            and unread_message.user_id <> p_user_id
            and unread_message.created_at > coalesce(read_state.last_read_at, 'epoch'::timestamptz)
        )
      )
      order by coalesce(last_message.created_at, channel_record.created_at) desc,
        channel_record.id desc
    ),
    '[]'::jsonb
  )
  from public.chat_direct_pairs direct_pair
  join public.chat_channels channel_record
    on channel_record.id = direct_pair.channel_id
    and channel_record.enabled
    and channel_record.type = 'direct'
  cross join lateral (
    select case
      when direct_pair.user_low = p_user_id then direct_pair.user_high
      else direct_pair.user_low
    end as partner_id
  ) partner
  left join public.profiles partner_profile on partner_profile.user_id = partner.partner_id
  left join public.chat_direct_reads read_state
    on read_state.channel_id = channel_record.id
    and read_state.user_id = p_user_id
  left join lateral (
    select message_record.created_at
    from public.chat_messages message_record
    where message_record.channel_id = channel_record.id
      and message_record.deleted_at is null
    order by message_record.created_at desc, message_record.id desc
    limit 1
  ) last_message on true
  left join lateral (
    select plan_record.code as plan_code, license_record.founder_number
    from public.licenses license_record
    join public.plans plan_record on plan_record.id = license_record.plan_id
    where license_record.user_id = partner.partner_id
      and license_record.status = 'active'
      and license_record.starts_at <= now()
      and (license_record.lifetime or license_record.expires_at > now())
      and plan_record.enabled
    order by plan_record.entitlement_rank desc,
      license_record.created_at desc,
      license_record.id desc
    limit 1
  ) partner_access on true
  where direct_pair.user_low = p_user_id or direct_pair.user_high = p_user_id;
$$;

create or replace function public.chat_start_direct(
  p_user_id uuid,
  p_recipient_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  low_user uuid;
  high_user uuid;
  direct_channel_id uuid;
  response jsonb;
begin
  if p_user_id = p_recipient_id then
    raise exception using errcode = '22023', message = 'cannot message self';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id)
    or not exists (select 1 from auth.users where id = p_recipient_id) then
    raise exception using errcode = 'P0002', message = 'chat user not found';
  end if;

  if p_user_id::text < p_recipient_id::text then
    low_user := p_user_id;
    high_user := p_recipient_id;
  else
    low_user := p_recipient_id;
    high_user := p_user_id;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'altgrid:direct:' || low_user::text || ':' || high_user::text,
    0
  ));

  select channel_id into direct_channel_id
  from public.chat_direct_pairs
  where user_low = low_user and user_high = high_user;

  if direct_channel_id is null then
    insert into public.chat_channels (type, game_id, name, enabled)
    values ('direct', null, 'Conversa direta', true)
    returning id into direct_channel_id;

    insert into public.chat_direct_pairs (channel_id, user_low, user_high)
    values (direct_channel_id, low_user, high_user);
  end if;

  insert into public.chat_direct_reads (channel_id, user_id, last_read_at)
  values (direct_channel_id, p_user_id, now())
  on conflict (channel_id, user_id) do update
  set last_read_at = greatest(public.chat_direct_reads.last_read_at, excluded.last_read_at);

  select jsonb_build_object(
    'id', direct_channel_id,
    'type', 'direct',
    'game_id', null,
    'name', coalesce(nullif(btrim(profile_record.display_name), ''), 'Jogador'),
    'participant_id', p_recipient_id,
    'participant_plan', coalesce(access.plan_code, 'FREE'),
    'participant_founder_number', access.founder_number,
    'unread', 0
  ) into response
  from (select 1) singleton
  left join public.profiles profile_record on profile_record.user_id = p_recipient_id
  left join lateral (
    select plan_record.code as plan_code, license_record.founder_number
    from public.licenses license_record
    join public.plans plan_record on plan_record.id = license_record.plan_id
    where license_record.user_id = p_recipient_id
      and license_record.status = 'active'
      and license_record.starts_at <= now()
      and (license_record.lifetime or license_record.expires_at > now())
      and plan_record.enabled
    order by plan_record.entitlement_rank desc,
      license_record.created_at desc,
      license_record.id desc
    limit 1
  ) access on true;

  return response;
end;
$$;

create or replace function public.chat_list_messages(
  p_user_id uuid,
  p_channel_id uuid,
  p_before timestamptz default null,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  channel_type text;
begin
  if p_page_size < 1 or p_page_size > 100 then
    raise exception using errcode = '22023', message = 'invalid page size';
  end if;

  select type into channel_type
  from public.chat_channels
  where id = p_channel_id and enabled;

  if channel_type is null then
    raise exception using errcode = 'P0002', message = 'chat channel not found';
  end if;

  if channel_type = 'direct' and not exists (
    select 1 from public.chat_direct_pairs
    where channel_id = p_channel_id
      and (user_low = p_user_id or user_high = p_user_id)
  ) then
    raise exception using errcode = '42501', message = 'direct chat forbidden';
  end if;

  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at, rows.id), '[]'::jsonb)
  into result
  from (
    select
      message_record.id,
      message_record.channel_id,
      message_record.user_id,
      coalesce(nullif(btrim(profile_record.display_name), ''), 'Usuário') as display_name,
      message_record.message,
      message_record.created_at,
      message_record.edited_at,
      coalesce(access.plan_code, 'FREE') as plan,
      access.founder_number
    from public.chat_messages message_record
    left join public.profiles profile_record on profile_record.user_id = message_record.user_id
    left join lateral (
      select plan_record.code as plan_code, license_record.founder_number
      from public.licenses license_record
      join public.plans plan_record on plan_record.id = license_record.plan_id
      where license_record.user_id = message_record.user_id
        and license_record.status = 'active'
        and license_record.starts_at <= now()
        and (license_record.lifetime or license_record.expires_at > now())
        and plan_record.enabled
      order by plan_record.entitlement_rank desc,
        license_record.created_at desc,
        license_record.id desc
      limit 1
    ) access on true
    where message_record.channel_id = p_channel_id
      and message_record.deleted_at is null
      and (p_before is null or message_record.created_at < p_before)
    order by message_record.created_at desc, message_record.id desc
    limit p_page_size + 1
  ) rows;

  if channel_type = 'direct' then
    insert into public.chat_direct_reads (channel_id, user_id, last_read_at)
    values (p_channel_id, p_user_id, now())
    on conflict (channel_id, user_id) do update
    set last_read_at = greatest(public.chat_direct_reads.last_read_at, excluded.last_read_at);
  end if;

  return result;
end;
$$;

create or replace function public.chat_send_message(
  p_user_id uuid,
  p_channel_id uuid,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_message text := btrim(p_message);
  inserted public.chat_messages;
  active_restriction public.chat_mutes;
  response jsonb;
  channel_type text;
begin
  if normalized_message = '' or char_length(normalized_message) > 500
    or normalized_message ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'invalid chat message';
  end if;

  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception using errcode = '23503', message = 'user not found';
  end if;

  select type into channel_type
  from public.chat_channels
  where id = p_channel_id and enabled;

  if channel_type is null then
    raise exception using errcode = 'P0002', message = 'chat channel not found';
  end if;

  if channel_type = 'direct' and not exists (
    select 1 from public.chat_direct_pairs
    where channel_id = p_channel_id
      and (user_low = p_user_id or user_high = p_user_id)
  ) then
    raise exception using errcode = '42501', message = 'direct chat forbidden';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('altgrid:chat:' || p_user_id::text, 0)
  );

  select * into active_restriction
  from public.chat_mutes
  where user_id = p_user_id
    and revoked_at is null
    and (kind = 'ban' or expires_at > now())
  order by created_at desc
  limit 1;

  if found then
    raise exception using errcode = '42501', message = case
      when active_restriction.kind = 'ban' then 'chat banned'
      else 'chat muted'
    end;
  end if;

  if (
    select count(*) from public.chat_messages
    where user_id = p_user_id and created_at > now() - interval '10 seconds'
  ) >= 5 or (
    select count(*) from public.chat_messages
    where user_id = p_user_id and created_at > now() - interval '1 minute'
  ) >= 20 then
    raise exception using errcode = 'P0001', message = 'chat rate limit';
  end if;

  insert into public.chat_messages (channel_id, user_id, message)
  values (p_channel_id, p_user_id, normalized_message)
  returning * into inserted;

  if channel_type = 'direct' then
    insert into public.chat_direct_reads (channel_id, user_id, last_read_at)
    values (p_channel_id, p_user_id, inserted.created_at)
    on conflict (channel_id, user_id) do update
    set last_read_at = greatest(public.chat_direct_reads.last_read_at, excluded.last_read_at);
  end if;

  select jsonb_build_object(
    'id', inserted.id,
    'channel_id', inserted.channel_id,
    'user_id', inserted.user_id,
    'display_name', coalesce(nullif(btrim(profile_record.display_name), ''), 'Usuário'),
    'message', inserted.message,
    'created_at', inserted.created_at,
    'edited_at', inserted.edited_at,
    'plan', coalesce(access.plan_code, 'FREE'),
    'founder_number', access.founder_number
  ) into response
  from (select 1) singleton
  left join public.profiles profile_record on profile_record.user_id = inserted.user_id
  left join lateral (
    select plan_record.code as plan_code, license_record.founder_number
    from public.licenses license_record
    join public.plans plan_record on plan_record.id = license_record.plan_id
    where license_record.user_id = inserted.user_id
      and license_record.status = 'active'
      and license_record.starts_at <= now()
      and (license_record.lifetime or license_record.expires_at > now())
      and plan_record.enabled
    order by plan_record.entitlement_rank desc,
      license_record.created_at desc,
      license_record.id desc
    limit 1
  ) access on true;

  return response;
end;
$$;

revoke all on function public.chat_list_direct_channels(uuid)
  from public, anon, authenticated;
revoke all on function public.chat_start_direct(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.chat_list_messages(uuid, uuid, timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.chat_send_message(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.chat_list_direct_channels(uuid) to service_role;
grant execute on function public.chat_start_direct(uuid, uuid) to service_role;
grant execute on function public.chat_list_messages(uuid, uuid, timestamptz, integer)
  to service_role;
grant execute on function public.chat_send_message(uuid, uuid, text) to service_role;
