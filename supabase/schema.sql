-- CodeBridge: выполнить целиком в Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 160),
  description text not null default '',
  language text not null default 'vba' check (language in ('vba','excel','javascript','python','sql','html','css','json','powershell','batch','text','other')),
  code text not null default '',
  tags text[] not null default '{}',
  is_favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.card_versions (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  description text not null default '',
  language text not null,
  code text not null,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  theme text not null default 'system' check (theme in ('system','light','dark')),
  card_view text not null default 'grid' check (card_view in ('grid','list')),
  default_language text not null default 'vba',
  autosave boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cards_user_id_idx on public.cards(user_id);
create index if not exists cards_updated_at_idx on public.cards(updated_at desc);
create index if not exists cards_deleted_at_idx on public.cards(deleted_at);
create index if not exists card_versions_card_id_idx on public.card_versions(card_id, created_at desc);
create index if not exists card_versions_user_id_idx on public.card_versions(user_id);

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
create or replace function public.save_card_version() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if row(old.title,old.description,old.language,old.code,old.tags) is distinct from row(new.title,new.description,new.language,new.code,new.tags) then
    insert into public.card_versions(card_id,user_id,title,description,language,code,tags)
    values(old.id,old.user_id,old.title,old.description,old.language,old.code,old.tags);
  end if;
  return new;
end; $$;
drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at before update on public.cards for each row execute function public.set_updated_at();
drop trigger if exists cards_save_version on public.cards;
create trigger cards_save_version before update on public.cards for each row execute function public.save_card_version();
drop trigger if exists settings_set_updated_at on public.user_settings;
create trigger settings_set_updated_at before update on public.user_settings for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.cards enable row level security;
alter table public.card_versions enable row level security;
alter table public.user_settings enable row level security;

-- Отдельные операции перечислены явно. WITH CHECK не позволяет подменить user_id.
create policy "profiles_select_own" on public.profiles for select using (id = (select auth.uid()));
create policy "profiles_insert_own" on public.profiles for insert with check (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles for update using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles_delete_own" on public.profiles for delete using (id = (select auth.uid()));
create policy "cards_select_own" on public.cards for select using (user_id = (select auth.uid()));
create policy "cards_insert_own" on public.cards for insert with check (user_id = (select auth.uid()));
create policy "cards_update_own" on public.cards for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "cards_delete_own" on public.cards for delete using (user_id = (select auth.uid()));
create policy "versions_select_own" on public.card_versions for select using (user_id = (select auth.uid()));
create policy "versions_insert_own" on public.card_versions for insert with check (user_id = (select auth.uid()) and exists(select 1 from public.cards c where c.id=card_id and c.user_id=(select auth.uid())));
create policy "versions_update_own" on public.card_versions for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "versions_delete_own" on public.card_versions for delete using (user_id = (select auth.uid()));
create policy "settings_select_own" on public.user_settings for select using (user_id = (select auth.uid()));
create policy "settings_insert_own" on public.user_settings for insert with check (user_id = (select auth.uid()));
create policy "settings_update_own" on public.user_settings for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "settings_delete_own" on public.user_settings for delete using (user_id = (select auth.uid()));

-- Realtime для синхронизации открытых устройств.
alter publication supabase_realtime add table public.cards;
