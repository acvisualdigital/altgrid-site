begin;

update public.plans
set
  features = jsonb_set(
    coalesce(features, '{}'::jsonb),
    '{account_proxy}',
    to_jsonb(code = 'FOUNDER'),
    true
  ),
  updated_at = now()
where code in ('FREE', 'PRO', 'PRO_PLUS', 'FOUNDER');

comment on column public.plans.features is
  'Mapa de recursos efetivos do plano. account_proxy é exclusivo do FOUNDER.';

commit;
