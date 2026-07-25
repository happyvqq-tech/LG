-- 家庭語言學習 PWA — Supabase Schema（CLAUDE.md 第 7 節）
-- 在 Supabase SQL Editor 直接執行本檔，再執行 seed.sql

-- ---------- profiles：家庭成員 ----------
create table if not exists profiles (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  languages     text[] not null default '{英文}',          -- 英文 / 日文 / 台語
  level         text not null default 'B1',                -- A2 / B1 / B2 / C1
  scenario_pool text[] not null default '{日常}',          -- 校園/日常/旅遊/職場/新聞時事/科技
  avatar_url    text,                                      -- 成員照片 data URL
  daily_plan    jsonb,                                     -- {time, minutes, days}
  vocab_pref    jsonb,                                     -- {exam, exam_level, daily_new}
  created_at    timestamptz not null default now()
);

-- ---------- tasks：每日任務 ----------
create table if not exists tasks (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  language     text not null,                              -- 英文 / 日文
  task_json    jsonb not null,
  status       text not null default 'pending' check (status in ('pending', 'done')),
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_tasks_profile_created on tasks (profile_id, created_at desc);

-- ---------- errors：個人錯誤記憶庫 ----------
create table if not exists errors (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles(id) on delete cascade,
  language     text not null,
  original     text not null,
  corrected    text not null,
  error_type   text not null,
  rule_note    text not null default '',
  status       text not null default 'active' check (status in ('active', 'pending_verify', 'resolved')),
  verify_count int  not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_errors_profile_status on errors (profile_id, status);

-- ---------- grammar_points：文法點 ----------
create table if not exists grammar_points (
  id          uuid primary key default gen_random_uuid(),
  language    text not null,                               -- 英文 / 日文
  name        text not null,
  level       text not null,                               -- 英文 A2-C1；日文 N4-N2
  description text not null default '',
  in_rotation boolean not null default false
);

create index if not exists idx_grammar_points_lang_rotation on grammar_points (language, in_rotation);

-- ---------- vocab_cards：單字卡（間隔重複） ----------
create table if not exists vocab_cards (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  language      text not null,
  word          text not null,
  reading       text not null default '',
  meaning_zh    text not null default '',
  pos           text not null default '',
  example       text not null default '',
  example_zh    text not null default '',
  collocations  text[] not null default '{}',
  exam          text not null default '',
  exam_level    text not null default '',
  source        text not null default 'list' check (source in ('list', 'ai', 'task')),
  stage         int  not null default 0,
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

-- ---------- vocab_quizzes：每日測驗成績 ----------
create table if not exists vocab_quizzes (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  language   text not null,
  quiz_date  date not null default current_date,
  score      real not null default 0,
  total      int  not null default 0,
  details    jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index if not exists idx_quiz_profile_date on vocab_quizzes (profile_id, language, quiz_date desc);

-- ---------- activity_log：每日活動紀錄（用於連續天數） ----------
create table if not exists activity_log (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  activity_date date not null default current_date,
  unique (profile_id, activity_date)
);

create index if not exists idx_activity_profile_date on activity_log (profile_id, activity_date desc);

-- ---------- particle_cards：文言虛詞專練（間隔重複） ----------
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

-- ---------- taiwanese_scripts：台語腳本 ----------
create table if not exists taiwanese_scripts (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  lines      jsonb not null default '[]',                  -- [{hanji, tailo, mandarin}]
  audio_urls jsonb not null default '{}',                  -- {line_index: url}
  created_at timestamptz not null default now()
);

-- ---------- RLS：自用專案，anon 可讀寫全部（家庭內部使用，不做隔離） ----------
alter table profiles          enable row level security;
alter table tasks             enable row level security;
alter table errors            enable row level security;
alter table grammar_points    enable row level security;
alter table vocab_cards       enable row level security;
alter table vocab_quizzes     enable row level security;
alter table activity_log      enable row level security;
alter table particle_cards    enable row level security;
alter table taiwanese_scripts enable row level security;

drop policy if exists "anon full access profiles"          on profiles;
drop policy if exists "anon full access tasks"             on tasks;
drop policy if exists "anon full access errors"            on errors;
drop policy if exists "anon full access grammar_points"    on grammar_points;
drop policy if exists "anon full access vocab_cards"       on vocab_cards;
drop policy if exists "anon full access vocab_quizzes"     on vocab_quizzes;
drop policy if exists "anon full access activity_log"       on activity_log;
drop policy if exists "anon full access particle_cards"     on particle_cards;
drop policy if exists "anon full access taiwanese_scripts" on taiwanese_scripts;

create policy "anon full access profiles"          on profiles          for all to anon using (true) with check (true);
create policy "anon full access tasks"             on tasks             for all to anon using (true) with check (true);
create policy "anon full access errors"            on errors            for all to anon using (true) with check (true);
create policy "anon full access grammar_points"    on grammar_points    for all to anon using (true) with check (true);
create policy "anon full access vocab_cards"       on vocab_cards       for all to anon using (true) with check (true);
create policy "anon full access vocab_quizzes"     on vocab_quizzes     for all to anon using (true) with check (true);
create policy "anon full access activity_log"       on activity_log      for all to anon using (true) with check (true);
create policy "anon full access particle_cards"     on particle_cards    for all to anon using (true) with check (true);
create policy "anon full access taiwanese_scripts" on taiwanese_scripts for all to anon using (true) with check (true);
