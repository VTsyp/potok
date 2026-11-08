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
  updated_by uuid references auth.users(id) on delete set null,
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

/* ---------- push-уведомления ---------- */

create extension if not exists pg_net with schema extensions;

alter table public.stream_states
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

drop policy if exists "stream_states_update_member" on public.stream_states;
create policy "stream_states_update_member" on public.stream_states
for update to authenticated
using (public.is_stream_member(stream_id, auth.uid()))
with check (public.is_stream_member(stream_id, auth.uid())
  and (updated_by is null or updated_by = auth.uid()));

drop policy if exists "stream_states_insert_member" on public.stream_states;
create policy "stream_states_insert_member" on public.stream_states
for insert to authenticated
with check (public.is_stream_member(stream_id, auth.uid())
  and (updated_by is null or updated_by = auth.uid()));

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_key text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own" on public.push_subscriptions
for select to authenticated
using (user_id = auth.uid());

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own" on public.push_subscriptions
for delete to authenticated
using (user_id = auth.uid());

revoke all on table public.push_subscriptions from anon, authenticated;
grant select, delete on table public.push_subscriptions to authenticated;

create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_key text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(trim(p_endpoint), '') = ''
     or coalesce(trim(p_p256dh), '') = ''
     or coalesce(trim(p_auth_key), '') = '' then
    raise exception 'invalid_subscription';
  end if;

  delete from public.push_subscriptions where endpoint = p_endpoint;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent, last_seen_at)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth_key, left(coalesce(p_user_agent, ''), 300), now());
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

/* ---------- текст уведомления ---------- */

create or replace function public.push_category_name(p_id text)
returns text
language sql
immutable
as $$
  select case p_id
    when 'food' then 'Продукты'
    when 'home' then 'Жильё'
    when 'transport' then 'Транспорт'
    when 'fun' then 'Развлечения'
    when 'health' then 'Здоровье'
    when 'clothes' then 'Одежда'
    when 'subs' then 'Подписки'
    when 'salary' then 'Зарплата'
    when 'freelance' then 'Фриланс'
    when 'gifts' then 'Подарки'
    when 'invest' then 'Инвестиции'
    else 'Другое'
  end;
$$;

create or replace function public.push_tx_note(p_tx jsonb)
returns text
language sql
immutable
as $$
  select case
    when coalesce(btrim(p_tx->>'note'), '') = '' then ''
    when lower(btrim(p_tx->>'note')) = lower(public.push_category_name(p_tx->>'category')) then ''
    else ' «' || left(regexp_replace(btrim(p_tx->>'note'), '\s+', ' ', 'g'), 40) || '»'
  end;
$$;

create or replace function public.push_money(p_base numeric, p_currency text)
returns text
language sql
stable
as $$
  select translate(
    to_char(
      coalesce(p_base, 0) / case p_currency
        when 'EUR' then 100
        when 'USD' then 90
        when 'RSD' then 0.85
        else 1
      end,
      case when p_currency in ('EUR', 'USD')
        then 'FM999G999G999G999D00'
        else 'FM999G999G999G999'
      end
    ),
    ',.', ' ,'
  ) || ' ' || case p_currency
    when 'EUR' then '€'
    when 'USD' then '$'
    when 'RSD' then 'дин.'
    else '₽'
  end;
$$;

create or replace function public.push_plural(p_n int, p_one text, p_few text, p_many text)
returns text
language sql
immutable
as $$
  select case
    when p_n % 100 between 11 and 14 then p_many
    when p_n % 10 = 1 then p_one
    when p_n % 10 between 2 and 4 then p_few
    else p_many
  end;
$$;

create or replace function public.push_describe_change(p_old jsonb, p_new jsonb)
returns text
language plpgsql
stable
as $$
declare
  v_currency text;
  v_parts text[] := '{}';
  v_extra int := 0;
  v_added jsonb;
  v_removed jsonb;
  v_changed jsonb;
  v_tx jsonb;
  v_old_goal jsonb;
  v_new_goal jsonb;
  v_body text;
begin
  p_old := coalesce(p_old, '{}'::jsonb);
  p_new := coalesce(p_new, '{}'::jsonb);
  v_currency := coalesce(p_new->>'currency', 'RUB');
  v_old_goal := p_old->'goal';
  v_new_goal := p_new->'goal';

  select jsonb_agg(n)
  into v_added
  from jsonb_array_elements(coalesce(p_new->'transactions', '[]'::jsonb)) n
  where not exists (
    select 1
    from jsonb_array_elements(coalesce(p_old->'transactions', '[]'::jsonb)) o
    where o->>'id' = n->>'id'
  );

  select jsonb_agg(o)
  into v_removed
  from jsonb_array_elements(coalesce(p_old->'transactions', '[]'::jsonb)) o
  where not exists (
    select 1
    from jsonb_array_elements(coalesce(p_new->'transactions', '[]'::jsonb)) n
    where n->>'id' = o->>'id'
  );

  select jsonb_agg(n)
  into v_changed
  from jsonb_array_elements(coalesce(p_new->'transactions', '[]'::jsonb)) n
  join jsonb_array_elements(coalesce(p_old->'transactions', '[]'::jsonb)) o
    on o->>'id' = n->>'id'
  where n <> o;

  if v_added is not null then
    v_tx := v_added->0;
    v_parts := array_append(v_parts,
      case when v_tx->>'type' = 'income' then 'Новый доход ' else 'Новый расход ' end
      || public.push_money((v_tx->>'amount')::numeric, v_currency)
      || ' · ' || public.push_category_name(v_tx->>'category')
      || public.push_tx_note(v_tx)
    );
    v_extra := v_extra + greatest(jsonb_array_length(v_added) - 1, 0);
  end if;

  if v_removed is not null then
    v_tx := v_removed->0;
    v_parts := array_append(v_parts,
      'Удалён ' || case when v_tx->>'type' = 'income' then 'доход ' else 'расход ' end
      || public.push_money((v_tx->>'amount')::numeric, v_currency)
      || ' · ' || public.push_category_name(v_tx->>'category')
      || public.push_tx_note(v_tx)
    );
    v_extra := v_extra + greatest(jsonb_array_length(v_removed) - 1, 0);
  end if;

  if v_changed is not null then
    v_tx := v_changed->0;
    if (v_tx - 'waste') = ((select o from jsonb_array_elements(coalesce(p_old->'transactions', '[]'::jsonb)) o where o->>'id' = v_tx->>'id' limit 1) - 'waste') then
      v_parts := array_append(v_parts,
        case when coalesce((v_tx->>'waste')::numeric, 0) > 0
          then 'Отмечены утечки ' || public.push_money((v_tx->>'waste')::numeric, v_currency)
          else 'Утечки сброшены'
        end
        || ' · ' || public.push_category_name(v_tx->>'category')
      );
    else
      v_parts := array_append(v_parts,
        'Изменён ' || case when v_tx->>'type' = 'income' then 'доход ' else 'расход ' end
        || public.push_money((v_tx->>'amount')::numeric, v_currency)
        || ' · ' || public.push_category_name(v_tx->>'category')
        || public.push_tx_note(v_tx)
      );
    end if;
    v_extra := v_extra + greatest(jsonb_array_length(v_changed) - 1, 0);
  end if;

  if v_old_goal is distinct from v_new_goal then
    if v_new_goal is null or jsonb_typeof(v_new_goal) = 'null' then
      v_parts := array_append(v_parts, 'Цель удалена');
    else
      v_parts := array_append(v_parts,
        'Цель «' || coalesce(nullif(btrim(v_new_goal->>'title'), ''), 'Моя цель') || '»'
        || case
             when v_new_goal->>'target' is distinct from v_old_goal->>'target'
               then ' — ' || public.push_money((v_new_goal->>'target')::numeric, v_currency)
             else ' · накоплено ' || public.push_money((v_new_goal->>'initial')::numeric, v_currency)
           end
      );
    end if;
  end if;

  if coalesce(p_old->>'currency', 'RUB') <> v_currency then
    v_parts := array_append(v_parts,
      'Валюта потока: ' || case v_currency
        when 'EUR' then '€'
        when 'USD' then '$'
        when 'RSD' then 'дин.'
        else '₽'
      end
    );
  end if;

  if array_length(v_parts, 1) is null then
    return 'Данные потока обновлены';
  end if;

  v_body := v_parts[1];
  v_extra := v_extra + coalesce(array_length(v_parts, 1), 1) - 1;

  if v_extra > 0 then
    v_body := v_body || ' · и ещё ' || v_extra || ' '
      || public.push_plural(v_extra, 'изменение', 'изменения', 'изменений');
  end if;

  return left(v_body, 180);
end;
$$;

create or replace function public.notify_stream_update()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
declare
  v_stream_name text;
  v_actor text;
  v_subscriptions jsonb;
  v_body text;
begin
  if new.state is not distinct from old.state then
    return new;
  end if;
  if new.updated_by is null then
    return new;
  end if;

  select s.name into v_stream_name
  from public.streams s
  where s.id = new.stream_id;

  select coalesce(nullif(p.name, ''), p.email, 'Участник') into v_actor
  from public.profiles p
  where p.id = new.updated_by;

  select coalesce(jsonb_agg(jsonb_build_object(
    'endpoint', ps.endpoint,
    'p256dh', ps.p256dh,
    'auth', ps.auth_key
  )), '[]'::jsonb)
  into v_subscriptions
  from public.push_subscriptions ps
  join public.stream_members sm on sm.user_id = ps.user_id
  where sm.stream_id = new.stream_id
    and sm.user_id <> new.updated_by;

  if jsonb_array_length(v_subscriptions) = 0 then
    return new;
  end if;

  v_body := public.push_describe_change(old.state, new.state);

  perform net.http_post(
    url := 'https://potok-ys2h.vercel.app/api/push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'title', coalesce(v_actor, 'Участник') || ' · ' || coalesce(v_stream_name, 'Поток'),
      'body', v_body,
      'url', '/?stream=' || new.stream_id::text,
      'tag', 'potok-' || new.stream_id::text,
      'subscriptions', v_subscriptions
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

drop trigger if exists on_stream_state_changed on public.stream_states;
create trigger on_stream_state_changed
after update of state on public.stream_states
for each row
when (new.state is distinct from old.state)
execute function public.notify_stream_update();
