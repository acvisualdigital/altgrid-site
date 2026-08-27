begin;

update public.plans
set max_accounts = 2147483647,
    updated_at = now()
where code = 'FOUNDER';

commit;