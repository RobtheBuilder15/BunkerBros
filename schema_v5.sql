-- Run this AFTER schema.sql, schema_v2_roles.sql, schema_v3.sql, schema_v4.sql.

-- Admin can reassign any member's Bro (same exclusivity + admin-role-
-- protection rules as the self-service set_my_player).
create or replace function admin_set_member_player(p_room_id uuid, p_user_id uuid, p_player_id text)
returns void language plpgsql security definer as $$
declare v_taken boolean;
begin
  if not is_room_admin(p_room_id) then
    raise exception 'NOT_ADMIN';
  end if;
  if p_player_id is distinct from 'unassigned' then
    select exists(
      select 1 from room_memberships
      where room_id = p_room_id and player_id = p_player_id and user_id <> p_user_id
    ) into v_taken;
    if v_taken then raise exception 'PLAYER_TAKEN'; end if;
  end if;
  update room_memberships
    set player_id = p_player_id,
        role = case when p_player_id = 'unassigned' and role <> 'admin' then 'viewer' else role end
  where room_id = p_room_id and user_id = p_user_id;
end;
$$;
grant execute on function admin_set_member_player(uuid, uuid, text) to authenticated;
