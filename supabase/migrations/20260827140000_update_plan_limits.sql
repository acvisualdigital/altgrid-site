begin;

update public.plans
set max_accounts = case code
  when 'PRO' then 6
  when 'FOUNDER' then 15
  else max_accounts
end,
updated_at = now()
where code in ('PRO', 'FOUNDER');

commit;