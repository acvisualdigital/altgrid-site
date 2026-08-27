begin;

update public.products
set metadata = case code
  when 'PRO_PLUS_UPGRADE' then
    '{"upgrade_from":"PRO_LIFETIME","discount_amount":20.00}'::jsonb
  when 'FOUNDER_UPGRADE' then
    '{"upgrade_from":"PRO_LIFETIME","discount_amount":20.00}'::jsonb
  when 'PLUS_FOUNDER_UPGRADE' then
    '{"upgrade_from":"PRO_PLUS_LIFETIME","discount_amount":40.00}'::jsonb
  else metadata
end,
updated_at = now()
where code in (
  'PRO_PLUS_UPGRADE',
  'FOUNDER_UPGRADE',
  'PLUS_FOUNDER_UPGRADE'
);

commit;
