begin;

update public.plans
set
  features = jsonb_set(
    coalesce(features, '{}'::jsonb),
    '{stonegy_bot}',
    to_jsonb(code in ('PRO', 'PRO_PLUS', 'FOUNDER')),
    true
  ),
  updated_at = now()
where code in ('FREE', 'PRO', 'PRO_PLUS', 'FOUNDER');

comment on column public.plans.features is
  'Mapa de recursos efetivos do plano. stonegy_bot é pago; account_proxy é exclusivo do FOUNDER.';

commit;
