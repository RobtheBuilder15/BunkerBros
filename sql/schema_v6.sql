-- Run this AFTER schema.sql through schema_v5.sql.

-- Super admins get admin-level access to every room's management functions
-- (update_room_settings, set_member_role, delete_room, admin_set_member_player)
-- without needing an actual membership row in that room.
create or replace function is_room_admin(p_room_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from room_memberships
    where room_id = p_room_id and user_id = auth.uid() and role = 'admin'
  ) or is_super_admin();
$$;
