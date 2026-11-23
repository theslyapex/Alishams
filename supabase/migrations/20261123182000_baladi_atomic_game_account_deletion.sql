create or replace function public.baladi_delete_game_account(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_group record;
  v_successor uuid;
  v_groups_transferred integer := 0;
  v_groups_removed integer := 0;
begin
  if p_user_id is null then raise exception 'حساب معتبر نیست.'; end if;
  for v_group in select id from public.baladi_groups where leader_id = p_user_id for update loop
    select user_id into v_successor from public.baladi_group_members
      where group_id = v_group.id and user_id <> p_user_id order by joined_at asc limit 1;
    if v_successor is null then
      delete from public.baladi_groups where id = v_group.id;
      v_groups_removed := v_groups_removed + 1;
    else
      update public.baladi_groups set leader_id = v_successor, updated_at = now() where id = v_group.id;
      update public.baladi_group_members set role = 'leader' where group_id = v_group.id and user_id = v_successor;
      v_groups_transferred := v_groups_transferred + 1;
    end if;
  end loop;
  update public.baladi_duel_matches set winner_id = null where winner_id = p_user_id;
  update public.baladi_group_messages set pinned_by = null where pinned_by = p_user_id;
  delete from public.baladi_group_messages where user_id = p_user_id;
  delete from public.baladi_global_chat_messages where user_id = p_user_id;
  delete from public.baladi_group_members where user_id = p_user_id;
  delete from public.baladi_duel_progress where user_id = p_user_id;
  delete from public.baladi_duel_invites where sender_id = p_user_id or recipient_id = p_user_id;
  delete from public.baladi_duel_matches where player_one = p_user_id or player_two = p_user_id;
  delete from public.baladi_game_hint_usage where user_id = p_user_id;
  delete from public.baladi_game_events where user_id = p_user_id;
  delete from public.baladi_game_sessions where user_id = p_user_id;
  delete from public.baladi_user_cosmetics where user_id = p_user_id;
  delete from public.baladi_game_profiles where user_id = p_user_id;
  return jsonb_build_object('deleted', true, 'groups_transferred', v_groups_transferred, 'groups_removed', v_groups_removed);
end;
$$;
revoke all on function public.baladi_delete_game_account(uuid) from public, anon, authenticated;
grant execute on function public.baladi_delete_game_account(uuid) to service_role;