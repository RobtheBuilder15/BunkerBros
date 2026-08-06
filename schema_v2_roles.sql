-- Run this AFTER schema.sql. Adds usernames, roles, and admin-only
-- management functions. Safe to run once.

create table if not exists profiles (
  id uuid primary key references auth.users,
  username text unique not null
);
alter table profiles enable row level security;
create policy "profiles readable by authenticated" on profiles for select using (auth.role() = 'authenticated');
create policy "insert own profile" on profiles for insert with check (id = auth.uid());

alter table room_memberships add column if not exists role text not null default 'editor'
  check (role in ('admin','editor','viewer'));

-- Helper used inside RLS policies so we don't get recursive-policy errors
-- when a policy on room_memberships needs to query room_memberships itself.
create or replace function is_room_admin(p_room_id uuid)
returns boolean language sql security definer stable as $$
  select exists (
    select 1 from room_memberships
    where room_id = p_room_id and user_id = auth.uid() and role = 'admin'
  );
$$;

-- Admins can see every membership row in rooms they administer (everyone
-- can still see their own row via the existing "own memberships select" policy).
create policy "admins can read room memberships" on room_memberships for select
  using (is_room_admin(room_id));

-- create_room now makes the creator an admin.
create or replace function create_room(p_name text, p_password text)
returns table(id uuid, room_code text) language plpgsql security definer as $$
declare
  v_count int;
  v_room_id uuid;
  v_code text;
begin
  select count(*) into v_count from room_memberships where user_id = auth.uid();
  if v_count >= 3 then
    raise exception 'ROOM_LIMIT_REACHED';
  end if;
  v_code := lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(md5(random()::text), 1, 4);
  insert into rooms (room_code, name, password, created_by)
  values (v_code, p_name, p_password, auth.uid())
  returning rooms.id into v_room_id;
  insert into room_memberships (user_id, room_id, role) values (auth.uid(), v_room_id, 'admin');
  return query select v_room_id, v_code;
end;
$$;

-- join_room now makes new joiners editors by default.
create or replace function join_room(p_room_code text, p_password text)
returns uuid language plpgsql security definer as $$
declare
  v_room rooms%rowtype;
  v_count int;
begin
  select * into v_room from rooms where room_code = p_room_code;
  if not found then
    raise exception 'ROOM_NOT_FOUND';
  end if;
  if v_room.password <> p_password then
    raise exception 'WRONG_PASSWORD';
  end if;
  if not exists (select 1 from room_memberships where user_id = auth.uid() and room_id = v_room.id) then
    select count(*) into v_count from room_memberships where user_id = auth.uid();
    if v_count >= 3 then
      raise exception 'ROOM_LIMIT_REACHED';
    end if;
    insert into room_memberships (user_id, room_id, role) values (auth.uid(), v_room.id, 'editor');
  end if;
  return v_room.id;
end;
$$;

-- Admin-only: rename a room / change its password.
create or replace function update_room_settings(p_room_id uuid, p_name text, p_password text)
returns void language plpgsql security definer as $$
begin
  if not is_room_admin(p_room_id) then
    raise exception 'NOT_ADMIN';
  end if;
  update rooms set
    name = coalesce(p_name, name),
    password = coalesce(nullif(p_password, ''), password)
  where id = p_room_id;
end;
$$;

-- Admin-only: change another member's role.
create or replace function set_member_role(p_room_id uuid, p_user_id uuid, p_role text)
returns void language plpgsql security definer as $$
begin
  if not is_room_admin(p_room_id) then
    raise exception 'NOT_ADMIN';
  end if;
  if p_role not in ('admin','editor','viewer') then
    raise exception 'BAD_ROLE';
  end if;
  update room_memberships set role = p_role where room_id = p_room_id and user_id = p_user_id;
end;
$$;

grant execute on function update_room_settings(uuid, text, text) to authenticated;
grant execute on function set_member_role(uuid, uuid, text) to authenticated;
