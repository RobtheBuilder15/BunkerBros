-- Run this AFTER schema.sql and schema_v2_roles.sql. Additive/safe to re-run.

-- Real email support (needed for password reset) + super-admin flag.
alter table profiles add column if not exists email text;
alter table profiles add column if not exists is_super_admin boolean not null default false;

drop policy if exists "insert own profile" on profiles;
create policy "insert own profile" on profiles for insert with check (id = auth.uid());
create policy "update own profile" on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Pre-auth username -> email lookup, used for login and "forgot password"
-- (a plain SELECT can't run before the user is authenticated).
create or replace function get_email_for_username(p_username text)
returns text language sql security definer stable as $$
  select email from profiles where lower(username) = lower(p_username) limit 1;
$$;
grant execute on function get_email_for_username(text) to anon, authenticated;

-- Clean up dependent rows automatically if a room or user is ever removed
-- directly, as a safety net alongside the explicit delete functions below.
alter table rooms drop constraint if exists rooms_created_by_fkey;
alter table rooms add constraint rooms_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;
alter table room_memberships drop constraint if exists room_memberships_user_id_fkey;
alter table room_memberships add constraint room_memberships_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
alter table room_memberships drop constraint if exists room_memberships_room_id_fkey;
alter table room_memberships add constraint room_memberships_room_id_fkey foreign key (room_id) references rooms(id) on delete cascade;

-- Raise the room cap from 3 to 5.
create or replace function create_room(p_name text, p_password text)
returns table(id uuid, room_code text) language plpgsql security definer as $$
declare
  v_count int; v_room_id uuid; v_code text;
begin
  select count(*) into v_count from room_memberships where user_id = auth.uid();
  if v_count >= 5 then raise exception 'ROOM_LIMIT_REACHED'; end if;
  v_code := lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(md5(random()::text), 1, 4);
  insert into rooms (room_code, name, password, created_by) values (v_code, p_name, p_password, auth.uid())
  returning rooms.id into v_room_id;
  insert into room_memberships (user_id, room_id, role) values (auth.uid(), v_room_id, 'admin');
  return query select v_room_id, v_code;
end;
$$;

create or replace function join_room(p_room_code text, p_password text)
returns uuid language plpgsql security definer as $$
declare v_room rooms%rowtype; v_count int;
begin
  select * into v_room from rooms where room_code = p_room_code;
  if not found then raise exception 'ROOM_NOT_FOUND'; end if;
  if v_room.password <> p_password then raise exception 'WRONG_PASSWORD'; end if;
  if not exists (select 1 from room_memberships where user_id = auth.uid() and room_id = v_room.id) then
    select count(*) into v_count from room_memberships where user_id = auth.uid();
    if v_count >= 5 then raise exception 'ROOM_LIMIT_REACHED'; end if;
    insert into room_memberships (user_id, room_id, role) values (auth.uid(), v_room.id, 'editor');
  end if;
  return v_room.id;
end;
$$;

-- Leave a room yourself (blocked if you're the only admin — promote someone
-- else first, or delete the room instead).
create or replace function leave_room(p_room_id uuid)
returns void language plpgsql security definer as $$
declare v_role text; v_admin_count int;
begin
  select role into v_role from room_memberships where room_id = p_room_id and user_id = auth.uid();
  if v_role is null then return; end if;
  if v_role = 'admin' then
    select count(*) into v_admin_count from room_memberships where room_id = p_room_id and role = 'admin';
    if v_admin_count <= 1 then raise exception 'LAST_ADMIN'; end if;
  end if;
  delete from room_memberships where room_id = p_room_id and user_id = auth.uid();
end;
$$;

-- Admin removes someone else from the room.
create or replace function remove_member(p_room_id uuid, p_user_id uuid)
returns void language plpgsql security definer as $$
declare v_role text; v_admin_count int;
begin
  if not is_room_admin(p_room_id) then raise exception 'NOT_ADMIN'; end if;
  if p_user_id = auth.uid() then raise exception 'USE_LEAVE_INSTEAD'; end if;
  select role into v_role from room_memberships where room_id = p_room_id and user_id = p_user_id;
  if v_role = 'admin' then
    select count(*) into v_admin_count from room_memberships where room_id = p_room_id and role = 'admin';
    if v_admin_count <= 1 then raise exception 'LAST_ADMIN'; end if;
  end if;
  delete from room_memberships where room_id = p_room_id and user_id = p_user_id;
end;
$$;

-- Admin deletes the entire room.
create or replace function delete_room(p_room_id uuid)
returns void language plpgsql security definer as $$
begin
  if not is_room_admin(p_room_id) then raise exception 'NOT_ADMIN'; end if;
  delete from room_memberships where room_id = p_room_id;
  delete from rooms where id = p_room_id;
end;
$$;

-- Self-service account deletion.
create or replace function delete_my_account()
returns void language plpgsql security definer as $$
begin
  delete from room_memberships where user_id = auth.uid();
  delete from profiles where id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function leave_room(uuid) to authenticated;
grant execute on function remove_member(uuid, uuid) to authenticated;
grant execute on function delete_room(uuid) to authenticated;
grant execute on function delete_my_account() to authenticated;

-- ---------------------------------------------------------------
-- Super admin ("god tier") — set is_super_admin=true on your own row
-- manually in the SQL editor once, e.g.:
--   update profiles set is_super_admin = true where username = 'yourusername';
-- ---------------------------------------------------------------
create or replace function is_super_admin()
returns boolean language sql security definer stable as $$
  select coalesce((select is_super_admin from profiles where id = auth.uid()), false);
$$;

create policy "super admins read all rooms" on rooms for select using (is_super_admin());
create policy "super admins update all rooms" on rooms for update using (is_super_admin());
create policy "super admins read all memberships" on room_memberships for select using (is_super_admin());

create or replace function super_list_rooms()
returns table(id uuid, room_code text, name text, created_at timestamptz, member_count bigint)
language sql security definer stable as $$
  select r.id, r.room_code, r.name, r.created_at, count(m.id)
  from rooms r left join room_memberships m on m.room_id = r.id
  where is_super_admin()
  group by r.id order by r.created_at desc;
$$;

create or replace function super_list_accounts()
returns table(id uuid, username text, email text, created_at timestamptz, room_count bigint)
language sql security definer stable as $$
  select p.id, p.username, p.email, u.created_at, count(m.id)
  from profiles p join auth.users u on u.id = p.id
  left join room_memberships m on m.user_id = p.id
  where is_super_admin()
  group by p.id, p.username, p.email, u.created_at order by u.created_at desc;
$$;

create or replace function super_delete_room(p_room_id uuid)
returns void language plpgsql security definer as $$
begin
  if not is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;
  delete from room_memberships where room_id = p_room_id;
  delete from rooms where id = p_room_id;
end;
$$;

create or replace function super_delete_account(p_user_id uuid)
returns void language plpgsql security definer as $$
begin
  if not is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;
  delete from room_memberships where user_id = p_user_id;
  delete from profiles where id = p_user_id;
  delete from auth.users where id = p_user_id;
end;
$$;

grant execute on function is_super_admin() to authenticated;
grant execute on function super_list_rooms() to authenticated;
grant execute on function super_list_accounts() to authenticated;
grant execute on function super_delete_room(uuid) to authenticated;
grant execute on function super_delete_account(uuid) to authenticated;
