begin;

create or replace function public.admin_clear_chat_messages(p_actor_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform public.admin_assert_actor(p_actor_user_id);
  update public.chat_messages
  set deleted_at = coalesce(deleted_at, now()), edited_at = coalesce(edited_at, now())
  where deleted_at is null;
  insert into public.admin_audit_logs (actor_user_id, action, target_type, target_id, after_data)
  values (p_actor_user_id, 'chat.messages.clear', 'chat', null,
    jsonb_build_object('scope', 'all', 'cleared_at', now()));
end;
$$;

revoke all on function public.admin_clear_chat_messages(uuid) from public, anon, authenticated;
grant execute on function public.admin_clear_chat_messages(uuid) to service_role;

commit;