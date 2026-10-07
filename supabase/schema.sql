-- Run in the Supabase SQL Editor as the project administrator.
-- Only these project-specific tables/functions/policies are changed.
begin;
create schema if not exists pigeon_private;
revoke all on schema pigeon_private from public, anon;
grant usage on schema pigeon_private to authenticated;

create or replace function public.valid_pigeon_speech(value text, noise integer[])
returns boolean language sql immutable set search_path = '' as $$
  select value is not null and noise is not null
    and char_length(value) <= 125 and cardinality(noise) <= 75
    and char_length(value) - cardinality(noise) <= 50
    and value !~ '9{5}' and value !~ '[[:cntrl:]]'
    and not exists (select 1 from unnest(noise) i where i is null or i < 0 or i >= char_length(value) or substr(value, i + 1, 1) not in ('9', '.'))
    and cardinality(noise) = (select count(distinct i) from unnest(noise) i);
$$;

create table if not exists public.pigeons (
  id uuid primary key,
  owner_id uuid not null references auth.users(id),
  sequence bigint generated always as identity unique,
  created_at timestamptz not null default now(),
  replaces uuid,
  asset jsonb not null,
  message text not null default '',
  automatic integer[] not null default '{}',
  constraint pigeon_speech_valid check (public.valid_pigeon_speech(message, automatic))
);
create index if not exists pigeons_owner_id_idx on public.pigeons(owner_id);
alter table public.pigeons enable row level security;
revoke all on public.pigeons from public, anon, authenticated;
grant select on public.pigeons to anon, authenticated;
grant update(message, automatic), delete on public.pigeons to authenticated;

drop policy if exists "Everyone reads pigeons" on public.pigeons;
create policy "Everyone reads pigeons" on public.pigeons for select to anon, authenticated using (true);
drop policy if exists "Owners edit speech" on public.pigeons;
create policy "Owners edit speech" on public.pigeons for update to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
drop policy if exists "Owners remove pigeons" on public.pigeons;
create policy "Owners remove pigeons" on public.pigeons for delete to authenticated
  using ((select auth.uid()) = owner_id);

-- Tombstones prevent retries from resurrecting deleted or FIFO-evicted pigeons.
create table if not exists pigeon_private.requests (
  id uuid primary key,
  owner_id uuid not null references auth.users(id)
);
revoke all on pigeon_private.requests from public, anon, authenticated;
alter table pigeon_private.requests enable row level security;

-- Definer privilege is restricted to the atomic 40-bird FIFO operation.
-- Users cannot choose another owner or choose which pigeon to evict.
create or replace function pigeon_private.create_pigeon(pigeon_id uuid, face_asset jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  visitor uuid := auth.uid();
  previous_owner uuid;
  oldest uuid;
  vertices integer;
begin
  if visitor is null then raise exception 'Anonymous authentication is required' using errcode = '42501'; end if;
  if pigeon_id is null then raise exception 'A pigeon ID is required'; end if;
  perform pg_advisory_xact_lock(999940);
  select owner_id into previous_owner from pigeon_private.requests where id = pigeon_id;
  if found then
    if previous_owner <> visitor then raise exception 'Not your pigeon' using errcode = '42501'; end if;
    return pigeon_id;
  end if;
  if face_asset is null or jsonb_typeof(face_asset) <> 'object'
    or octet_length(face_asset::text) > 1000000
    or jsonb_typeof(face_asset->'positions') is distinct from 'array'
    or jsonb_typeof(face_asset->'uv') is distinct from 'array'
    or jsonb_typeof(face_asset->'photoWeights') is distinct from 'array'
    or jsonb_typeof(face_asset->'indices') is distinct from 'array'
    or jsonb_typeof(face_asset->'image') is distinct from 'string' then raise exception 'Invalid face asset'; end if;
  vertices := jsonb_array_length(face_asset->'positions') / 3;
  if vertices < 3 or vertices > 2000 or jsonb_array_length(face_asset->'positions') % 3 <> 0
    or jsonb_array_length(face_asset->'uv') <> vertices * 2
    or jsonb_array_length(face_asset->'photoWeights') <> vertices
    or jsonb_array_length(face_asset->'indices') not between 3 and 12000
    or jsonb_array_length(face_asset->'indices') % 3 <> 0
    or length(face_asset->>'image') > 700000
    or (face_asset->>'image') !~ '^data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}$' then raise exception 'Invalid face asset dimensions'; end if;
  if exists (select 1 from jsonb_array_elements(face_asset->'positions') n where jsonb_typeof(n) <> 'number' or abs(n::text::numeric) > 5)
    or exists (select 1 from jsonb_array_elements(face_asset->'uv') n where jsonb_typeof(n) <> 'number' or n::text::numeric not between 0 and 1)
    or exists (select 1 from jsonb_array_elements(face_asset->'photoWeights') n where jsonb_typeof(n) <> 'number' or n::text::numeric not between 0 and 1)
    or exists (select 1 from jsonb_array_elements(face_asset->'indices') n where jsonb_typeof(n) <> 'number' or n::text::numeric <> trunc(n::text::numeric) or n::text::numeric not between 0 and vertices - 1)
    then raise exception 'Invalid face asset values'; end if;
  if (select count(*) from public.pigeons) >= 40 then
    select id into oldest from public.pigeons order by sequence limit 1;
    delete from public.pigeons where id = oldest;
  end if;
  insert into pigeon_private.requests(id, owner_id) values (pigeon_id, visitor);
  insert into public.pigeons(id, owner_id, asset, replaces) values (pigeon_id, visitor, face_asset, oldest);
  return pigeon_id;
end;
$$;
revoke all on function pigeon_private.create_pigeon(uuid, jsonb) from public, anon;
grant execute on function pigeon_private.create_pigeon(uuid, jsonb) to authenticated;

create or replace function public.create_pigeon(pigeon_id uuid, face_asset jsonb)
returns uuid language sql security invoker set search_path = '' as $$
  select pigeon_private.create_pigeon(pigeon_id, face_asset);
$$;
revoke all on function public.create_pigeon(uuid, jsonb) from public, anon;
grant execute on function public.create_pigeon(uuid, jsonb) to authenticated;
commit;
