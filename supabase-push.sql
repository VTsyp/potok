-- Поток: push-уведомления при изменениях в общем потоке.
-- Выполните этот файл один раз в Supabase Dashboard -> SQL Editor -> Run.

create extension if not exists pg_net with schema extensions;

/* Кто последним изменил состояние потока. Нужно, чтобы не уведомлять автора изменения. */
alter table public.stream_states
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

/* Подписки браузеров и установленных приложений на push. */
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

/* Сохранение подписки. Заодно переносит endpoint на текущего пользователя,
   если на этом устройстве раньше входил другой аккаунт. */
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

/* При изменении состояния потока отправляем событие в Vercel.
   Vercel уже рассылает push по подпискам участников, кроме автора изменения. */
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

  perform net.http_post(
    url := 'https://potok-ys2h.vercel.app/api/push',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object(
      'title', 'Поток · ' || coalesce(v_stream_name, 'общий поток'),
      'body', coalesce(v_actor, 'Участник') || ' изменил(а) данные в потоке «' || coalesce(v_stream_name, 'Поток') || '»',
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
