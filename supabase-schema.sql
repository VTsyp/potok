-- Поток: схема облачной версии для Supabase.
-- Выполните этот файл один раз в Supabase Dashboard -> SQL Editor -> Run.

create extension if not exists pgcrypto;

/* ---------- профили ---------- */
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  created_at timestamptz not null default now()
);

/* ---------- потоки ---------- */
create table if not exists public.streams (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Мой поток',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

/* Состояние потока хранится одним JSON: операции, цель и валюта. */
create table if not exists public.stream_states (
  stream_id uuid primary key references public.streams(id) on delete cascade,
  state jsonb not null default '{"currency":"RUB","transactions":[],"goal":null}'::jsonb,
  updated_at timestamptz not null default now()
);

/* Участники потока. */
create table if not exists public.stream_members (
  stream_id uuid not null references public.streams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (stream_id, user_id)
);

/* Приглашения привязаны к конкретному потоку. */
create table if not exists public.stream_invites (
  code text primary key,
  stream_id uuid not null references public.streams(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked boolean not null default false
);

create index if not exists stream_members_user_idx on public.stream_members(user_id);
create index if not exists stream_members_stream_idx on public.stream_members(stream_id);
create index if not exists stream_invites_stream_idx on public.stream_invites(stream_id);

/* Проверка членства без рекурсии в RLS. */
create or replace function public.is_stream_member(p_stream_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.stream_members
    where stream_id = p_stream_id and user_id = p_user_id
  );
$$;

revoke all on function public.is_stream_member(uuid, uuid) from public;
grant execute on function public.is_stream_member(uuid, uuid) to authenticated;

/* Профиль создаётся автоматически при регистрации. */
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'name', ''), split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (id) do update
    set email = excluded.email,
        name = coalesce(nullif(public.profiles.name, ''), excluded.name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

/* Создание потока: владелец, участник и пустое состояние. */
create or replace function public.create_stream(p_name text default 'Мой поток')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  v_name := coalesce(nullif(trim(p_name), ''), 'Мой поток');

  insert into public.streams (name, owner_id)
  values (left(v_name, 60), auth.uid())
  returning id into v_id;

  insert into public.stream_members (stream_id, user_id, role)
  values (v_id, auth.uid(), 'owner');

  insert into public.stream_states (stream_id, state)
  values (v_id, '{"currency":"RUB","transactions":[],"goal":null}'::jsonb);

  return v_id;
end;
$$;

revoke all on function public.create_stream(text) from public;
grant execute on function public.create_stream(text) to authenticated;

/* Приглашение в конкретный поток. */
create or replace function public.create_stream_invite(p_stream_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_stream_member(p_stream_id, auth.uid()) then
    raise exception 'not a member';
  end if;

  loop
    v_code := 'P';
    for i in 1..5 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (
      select 1 from public.stream_invites where code = v_code
    );
  end loop;

  insert into public.stream_invites (code, stream_id, created_by, expires_at)
  values (v_code, p_stream_id, auth.uid(), now() + interval '90 days');

  return v_code;
end;
$$;

revoke all on function public.create_stream_invite(uuid) from public;
grant execute on function public.create_stream_invite(uuid) to authenticated;

/* Вступление по коду приглашения. */
create or replace function public.join_stream(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stream_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select stream_id into v_stream_id
  from public.stream_invites
  where code = upper(trim(p_code))
    and not revoked
    and (expires_at is null or expires_at > now())
  limit 1;

  if v_stream_id is null then
    raise exception 'invite_not_found';
  end if;

  insert into public.stream_members (stream_id, user_id, role)
  values (v_stream_id, auth.uid(), 'member')
  on conflict (stream_id, user_id) do nothing;

  return v_stream_id;
end;
$$;

revoke all on function public.join_stream(text) from public;
grant execute on function public.join_stream(text) to authenticated;

/* ---------- RLS ---------- */
alter table public.profiles enable row level security;
alter table public.streams enable row level security;
alter table public.stream_states enable row level security;
alter table public.stream_members enable row level security;
alter table public.stream_invites enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
for select to authenticated
using (id = auth.uid());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
for insert to authenticated
with check (id = auth.uid());

drop policy if exists "streams_select_member" on public.streams;
create policy "streams_select_member" on public.streams
for select to authenticated
using (public.is_stream_member(id, auth.uid()));

drop policy if exists "streams_update_owner" on public.streams;
create policy "streams_update_owner" on public.streams
for update to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "streams_delete_owner" on public.streams;
create policy "streams_delete_owner" on public.streams
for delete to authenticated
using (owner_id = auth.uid());

drop policy if exists "stream_states_select_member" on public.stream_states;
create policy "stream_states_select_member" on public.stream_states
for select to authenticated
using (public.is_stream_member(stream_id, auth.uid()));

drop policy if exists "stream_states_update_member" on public.stream_states;
create policy "stream_states_update_member" on public.stream_states
for update to authenticated
using (public.is_stream_member(stream_id, auth.uid()))
with check (public.is_stream_member(stream_id, auth.uid()));

drop policy if exists "stream_states_insert_member" on public.stream_states;
create policy "stream_states_insert_member" on public.stream_states
for insert to authenticated
with check (public.is_stream_member(stream_id, auth.uid()));

drop policy if exists "stream_members_select_member" on public.stream_members;
create policy "stream_members_select_member" on public.stream_members
for select to authenticated
using (public.is_stream_member(stream_id, auth.uid()));

drop policy if exists "stream_members_delete_owner" on public.stream_members;
create policy "stream_members_delete_owner" on public.stream_members
for delete to authenticated
using (
  exists (
    select 1 from public.streams s
    where s.id = stream_members.stream_id and s.owner_id = auth.uid()
  )
  and user_id <> auth.uid()
);

/* К приглашениям нет прямого доступа: только через RPC. */
revoke all on table public.stream_invites from anon, authenticated;

/* Realtime для обновлений состояния потока. */
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.stream_states;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
