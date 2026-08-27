begin;

update public.products
set
  price_amount = case code
    when 'PRO_LIFETIME' then 24.99
    when 'FOUNDER_LIFETIME' then 99.99
  end,
  currency = 'BRL',
  lifetime = true,
  enabled = true,
  updated_at = now()
where code in ('PRO_LIFETIME', 'FOUNDER_LIFETIME');

commit;