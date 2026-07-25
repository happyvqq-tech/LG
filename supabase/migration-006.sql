-- migration 006：連續天數（activity_log）+ 虛詞專練（particle_cards）
-- 在 Supabase SQL Editor 執行一次即可（可重複執行）

create table if not exists activity_log (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  activity_date date not null default current_date,
  unique (profile_id, activity_date)
);

create index if not exists idx_activity_profile_date on activity_log (profile_id, activity_date desc);

create table if not exists particle_cards (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  language      text not null default '古文',
  word          text not null,
  stage         int  not null default 0,
  ease          real not null default 2.5,
  interval_days int  not null default 0,
  repetitions   int  not null default 0,
  lapses        int  not null default 0,
  due_date      date not null default current_date,
  created_at    timestamptz not null default now(),
  unique (profile_id, language, word)
);

create index if not exists idx_particle_due on particle_cards (profile_id, language, due_date);

alter table activity_log  enable row level security;
alter table particle_cards enable row level security;

drop policy if exists "anon full access activity_log"   on activity_log;
drop policy if exists "anon full access particle_cards" on particle_cards;

create policy "anon full access activity_log"   on activity_log   for all to anon using (true) with check (true);
create policy "anon full access particle_cards" on particle_cards for all to anon using (true) with check (true);
