-- Run this in Supabase SQL Editor. Safe to run once.
-- Drops the old single-table sync approach in favor of accounts + rooms.

drop table if exists bonanza_games;

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text unique not null,
  name text not null,
  password text not null,
  config jsonb not null default '{}'::jsonb,
  rounds jsonb not null default '{}'::jsonb,
  archived_seasons jsonb not null default '[]'::jsonb,
  year text,
  created_by uuid references auth.users,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists room_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  room_id uuid references rooms not null,
  player_id text,
  created_at timestamptz default now(),
  unique(user_id, room_id)
);

alter table rooms enable row level security;
alter table room_memberships enable row level security;

-- Members can read/update a room; non-members can't see it at all (so a
-- stranger can't browse room contents even if they guess a room_code).
create policy "members can read rooms" on rooms for select
  using (exists (select 1 from room_memberships m where m.room_id = rooms.id and m.user_id = auth.uid()));
create policy "members can update rooms" on rooms for update
  using (exists (select 1 from room_memberships m where m.room_id = rooms.id and m.user_id = auth.uid()));

-- You can only see/edit your own membership rows.
create policy "own memberships select" on room_memberships for select
  using (user_id = auth.uid());
create policy "own memberships update" on room_memberships for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Room creation and joining go through these functions so the room
-- password is checked server-side and never sent back to the client.
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
  insert into room_memberships (user_id, room_id) values (auth.uid(), v_room_id);
  return query select v_room_id, v_code;
end;
$$;

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
    insert into room_memberships (user_id, room_id) values (auth.uid(), v_room.id);
  end if;
  return v_room.id;
end;
$$;

grant execute on function create_room(text, text) to authenticated;
grant execute on function join_room(text, text) to authenticated;

alter publication supabase_realtime add table rooms;
