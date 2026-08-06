-- Run this AFTER schema.sql, schema_v2_roles.sql, schema_v3.sql.

-- Tighten room_memberships updates: a plain client UPDATE can now only ever
-- touch player_id. Role changes must go through set_member_role /
-- set_my_player (both SECURITY DEFINER), closing a gap where any member
-- could previously have updated their own role column directly.
revoke update on room_memberships from authenticated;
grant update (player_id) on room_memberships to authenticated;

-- Returns which player slots are already claimed in a room (not who by —
-- just which ids are taken), so the UI can grey them out.
create or replace function get_taken_players(p_room_id uuid)
returns text[] language sql security definer stable as $$
  select coalesce(array_agg(distinct player_id) filter (where player_id is not null and player_id <> 'unassigned'), '{}')
  from room_memberships where room_id = p_room_id;
$$;
grant execute on function get_taken_players(uuid) to authenticated;

-- Self-service "which Bro am I" — enforces exclusivity server-side (a
-- client can't just claim an already-taken slot by calling this directly)
-- and auto-demotes non-admins to viewer when they pick Unassigned.
create or replace function set_my_player(p_room_id uuid, p_player_id text)
returns void language plpgsql security definer as $$
declare v_taken boolean;
begin
  if p_player_id is distinct from 'unassigned' then
    select exists(
      select 1 from room_memberships
      where room_id = p_room_id and player_id = p_player_id and user_id <> auth.uid()
    ) into v_taken;
    if v_taken then raise exception 'PLAYER_TAKEN'; end if;
  end if;
  update room_memberships
    set player_id = p_player_id,
        role = case when p_player_id = 'unassigned' and role <> 'admin' then 'viewer' else role end
  where room_id = p_room_id and user_id = auth.uid();
end;
$$;
grant execute on function set_my_player(uuid, text) to authenticated;
