-- migration 004：每日測驗成績紀錄
-- 在 Supabase SQL Editor 執行一次即可（可重複執行）

create table if not exists vocab_quizzes (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  language   text not null,
  quiz_date  date not null default current_date,
  score      real not null default 0,          -- 得分（答對 1、差一點 0.5）
  total      int  not null default 0,          -- 題數
  details    jsonb not null default '[]',      -- [{word, input, verdict, used_hint}]
  created_at timestamptz not null default now()
);

create index if not exists idx_quiz_profile_date on vocab_quizzes (profile_id, language, quiz_date desc);

alter table vocab_quizzes enable row level security;
drop policy if exists "anon full access vocab_quizzes" on vocab_quizzes;
create policy "anon full access vocab_quizzes" on vocab_quizzes for all to anon using (true) with check (true);
