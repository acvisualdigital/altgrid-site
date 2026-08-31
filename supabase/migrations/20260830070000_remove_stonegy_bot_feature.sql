begin;

update public.plans
set
  features = coalesce(features, '{}'::jsonb) - 'stonegy_bot',
  updated_at = now()
where coalesce(features, '{}'::jsonb) ? 'stonegy_bot';

comment on column public.plans.features is
  'Mapa de recursos efetivos do plano. account_proxy é exclusivo do FOUNDER.';

commit;
