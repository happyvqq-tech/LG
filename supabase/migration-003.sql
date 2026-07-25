-- migration 003：單字學習模組（單字卡 + 間隔重複排程）
-- 在 Supabase SQL Editor 執行一次即可（可重複執行）

alter table profiles
  add column if not exists vocab_pref jsonb;   -- {exam, exam_level, daily_new}

create table if not exists vocab_cards (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  language      text not null,                       -- 英文 / 日文
  word          text not null,
  reading       text not null default '',            -- 音標 / 假名
  meaning_zh    text not null default '',
  pos           text not null default '',
  example       text not null default '',
  example_zh    text not null default '',
  collocations  text[] not null default '{}',
  exam          text not null default '',            -- TOEIC/TOEFL/IELTS/Cambridge/JLPT
  exam_level    text not null default '',
  source        text not null default 'list' check (source in ('list', 'ai', 'task')),
  -- 間隔重複狀態
  stage         int  not null default 0,             -- 0 初見 → 5 已學會
  ease          real not null default 2.5,
  interval_days int  not null default 0,
  repetitions   int  not null default 0,
  lapses        int  not null default 0,
  due_date      date not null default current_date,
  created_at    timestamptz not null default now(),
  unique (profile_id, language, word)
);

create index if not exists idx_vocab_due on vocab_cards (profile_id, language, due_date);
create index if not exists idx_vocab_stage on vocab_cards (profile_id, language, stage);

alter table vocab_cards enable row level security;
drop policy if exists "anon full access vocab_cards" on vocab_cards;
create policy "anon full access vocab_cards" on vocab_cards for all to anon using (true) with check (true);
