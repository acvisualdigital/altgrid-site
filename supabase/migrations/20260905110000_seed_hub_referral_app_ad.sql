begin;

do $$
declare
  owner_id uuid;
  campaign_id constant uuid := 'a1b70000-0000-4000-8000-000000000001';
begin
  select id into owner_id
  from auth.users
  where lower(email) = 'yacaciio@gmail.com'
  order by created_at asc
  limit 1;

  if owner_id is null then
    raise exception 'AltGrid owner account was not found';
  end if;

  insert into public.app_ad_requests (
    id, user_id, plan_code, category, game_slug,
    catalog_game_name, catalog_launch_url, catalog_icon_url,
    advertiser_name, title, description, destination_url, image_url,
    cta_label, requested_days, quoted_amount, currency, status,
    admin_notes, reviewed_by, reviewed_at, starts_at, ends_at
  ) values (
    campaign_id, owner_id, 'impact', 'site', null,
    null, null, null,
    'Hub.xyz · indicação AltGrid',
    'Conheça o Hub e ganhe dinheiro de casa',
    'Participe de tarefas de treinamento de IA com imagem, áudio e vídeo. Escaneie o QR ou abra o link para conhecer.',
    'https://ai.hub.xyz/r/6QNQS152',
    'https://altgrid.com.br/assets/ads/hub-referral-banner.png',
    'Conheça o Hub', 365, 1.00, 'BRL', 'approved',
    'Campanha institucional de indicação do AltGrid.',
    owner_id, now(), now(), now() + interval '365 days'
  )
  on conflict (id) do update set
    user_id = excluded.user_id,
    plan_code = excluded.plan_code,
    category = excluded.category,
    advertiser_name = excluded.advertiser_name,
    title = excluded.title,
    description = excluded.description,
    destination_url = excluded.destination_url,
    image_url = excluded.image_url,
    cta_label = excluded.cta_label,
    requested_days = excluded.requested_days,
    quoted_amount = excluded.quoted_amount,
    currency = excluded.currency,
    status = 'approved',
    admin_notes = excluded.admin_notes,
    reviewed_by = owner_id,
    reviewed_at = now(),
    starts_at = now(),
    ends_at = now() + interval '365 days',
    updated_at = now();
end;
$$;

commit;
