begin;

update public.plans
set name = 'PLUS',
    updated_at = now()
where code = 'PRO_PLUS';

update public.products
set name = 'PLUS Lifetime',
    description = 'Acesso vitalício ao plano PLUS.',
    price_amount = 49.99,
    updated_at = now()
where code = 'PRO_PLUS_LIFETIME';

commit;
