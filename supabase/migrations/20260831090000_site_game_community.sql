begin;

create table public.site_game_favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  game_slug text not null references public.games (slug) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, game_slug)
);

create table public.site_game_likes (
  user_id uuid not null references auth.users (id) on delete cascade,
  game_slug text not null references public.games (slug) on update cascade on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, game_slug)
);

create table public.site_game_votes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  game_slug text not null references public.games (slug) on update cascade on delete cascade,
  created_at timestamptz not null default now()
);

create index site_game_votes_game_created_idx
  on public.site_game_votes (game_slug, created_at desc);
create index site_game_votes_user_game_created_idx
  on public.site_game_votes (user_id, game_slug, created_at desc);

create table public.site_game_reviews (
  user_id uuid not null references auth.users (id) on delete cascade,
  game_slug text not null references public.games (slug) on update cascade on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  comment text not null check (char_length(btrim(comment)) between 8 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_slug)
);

create trigger site_game_reviews_set_updated_at
before update on public.site_game_reviews
for each row execute function public.set_updated_at();

alter table public.site_game_favorites enable row level security;
alter table public.site_game_likes enable row level security;
alter table public.site_game_votes enable row level security;
alter table public.site_game_reviews enable row level security;

revoke all on table public.site_game_favorites from public, anon, authenticated;
revoke all on table public.site_game_likes from public, anon, authenticated;
revoke all on table public.site_game_votes from public, anon, authenticated;
revoke all on table public.site_game_reviews from public, anon, authenticated;

create or replace function public.get_site_game_community()
returns table (
  game_slug text,
  votes bigint,
  votes_12h bigint,
  likes bigint,
  reviews bigint,
  rating numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    game.slug as game_slug,
    (select count(*) from public.site_game_votes vote
      where vote.game_slug = game.slug
        and vote.created_at >= date_trunc('month', now())) as votes,
    (select count(*) from public.site_game_votes vote
      where vote.game_slug = game.slug
        and vote.created_at >= now() - interval '12 hours') as votes_12h,
    (select count(*) from public.site_game_likes liked
      where liked.game_slug = game.slug) as likes,
    (select count(*) from public.site_game_reviews review
      where review.game_slug = game.slug) as reviews,
    coalesce((select round(avg(review.rating)::numeric, 2)
      from public.site_game_reviews review
      where review.game_slug = game.slug), 0) as rating
  from public.games game
  where game.enabled = true
  order by game.sort_order, game.name;
$$;

create or replace function public.get_site_game_reviews(p_game_slug text)
returns table (
  author text,
  rating smallint,
  comment text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(nullif(btrim(profile.display_name), ''), 'Jogador AltGrid') as author,
    review.rating,
    review.comment,
    review.created_at,
    review.updated_at
  from public.site_game_reviews review
  left join public.profiles profile on profile.user_id = review.user_id
  where review.game_slug = p_game_slug
  order by review.updated_at desc
  limit 50;
$$;

create or replace function public.get_my_site_game_state()
returns table (
  game_slug text,
  favorited boolean,
  liked boolean,
  last_voted_at timestamptz,
  review_rating smallint,
  review_comment text,
  review_created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    game.slug,
    exists(select 1 from public.site_game_favorites favorite where favorite.user_id = auth.uid() and favorite.game_slug = game.slug),
    exists(select 1 from public.site_game_likes liked where liked.user_id = auth.uid() and liked.game_slug = game.slug),
    (select max(vote.created_at) from public.site_game_votes vote where vote.user_id = auth.uid() and vote.game_slug = game.slug),
    review.rating,
    review.comment,
    review.created_at
  from public.games game
  left join public.site_game_reviews review on review.user_id = auth.uid() and review.game_slug = game.slug
  where auth.uid() is not null and game.enabled = true;
$$;

create or replace function public.toggle_site_game_favorite(p_game_slug text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not exists(select 1 from public.games where slug = p_game_slug and enabled) then
    raise exception 'game not found' using errcode = 'P0002';
  end if;
  if exists(select 1 from public.site_game_favorites where user_id = actor and game_slug = p_game_slug) then
    delete from public.site_game_favorites where user_id = actor and game_slug = p_game_slug;
    return false;
  end if;
  insert into public.site_game_favorites (user_id, game_slug) values (actor, p_game_slug);
  return true;
end;
$$;

create or replace function public.toggle_site_game_like(p_game_slug text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not exists(select 1 from public.games where slug = p_game_slug and enabled) then
    raise exception 'game not found' using errcode = 'P0002';
  end if;
  if exists(select 1 from public.site_game_likes where user_id = actor and game_slug = p_game_slug) then
    delete from public.site_game_likes where user_id = actor and game_slug = p_game_slug;
    return false;
  end if;
  insert into public.site_game_likes (user_id, game_slug) values (actor, p_game_slug);
  return true;
end;
$$;

create or replace function public.cast_site_game_vote(p_game_slug text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  previous_vote timestamptz;
  current_vote timestamptz := now();
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not exists(select 1 from public.games where slug = p_game_slug and enabled) then
    raise exception 'game not found' using errcode = 'P0002';
  end if;
  select max(created_at) into previous_vote
  from public.site_game_votes
  where user_id = actor and game_slug = p_game_slug;
  if previous_vote is not null and previous_vote > current_vote - interval '12 hours' then
    raise exception 'vote cooldown' using errcode = 'P0001';
  end if;
  insert into public.site_game_votes (user_id, game_slug, created_at)
  values (actor, p_game_slug, current_vote);
  return current_vote;
end;
$$;

create or replace function public.upsert_site_game_review(
  p_game_slug text,
  p_rating integer,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  clean_comment text := btrim(coalesce(p_comment, ''));
begin
  if actor is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if not exists(select 1 from public.games where slug = p_game_slug and enabled) then
    raise exception 'game not found' using errcode = 'P0002';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'invalid rating' using errcode = '22023';
  end if;
  if char_length(clean_comment) not between 8 and 500 then
    raise exception 'invalid review length' using errcode = '22023';
  end if;
  insert into public.site_game_reviews (user_id, game_slug, rating, comment)
  values (actor, p_game_slug, p_rating, clean_comment)
  on conflict (user_id, game_slug) do update
  set rating = excluded.rating,
      comment = excluded.comment,
      updated_at = now();
end;
$$;

revoke all on function public.get_site_game_community() from public;
revoke all on function public.get_site_game_reviews(text) from public;
revoke all on function public.get_my_site_game_state() from public;
revoke all on function public.toggle_site_game_favorite(text) from public;
revoke all on function public.toggle_site_game_like(text) from public;
revoke all on function public.cast_site_game_vote(text) from public;
revoke all on function public.upsert_site_game_review(text, integer, text) from public;

grant execute on function public.get_site_game_community() to anon, authenticated;
grant execute on function public.get_site_game_reviews(text) to anon, authenticated;
grant execute on function public.get_my_site_game_state() to authenticated;
grant execute on function public.toggle_site_game_favorite(text) to authenticated;
grant execute on function public.toggle_site_game_like(text) to authenticated;
grant execute on function public.cast_site_game_vote(text) to authenticated;
grant execute on function public.upsert_site_game_review(text, integer, text) to authenticated;

commit;
