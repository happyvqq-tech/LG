-- migration 009：泛聽教材（extensive_listens）
-- 在 Supabase SQL Editor 執行一次即可（可重複執行）
--
-- 為什麼不塞進 tasks 表：泛聽沒有語塊、沒有寫作題、沒有批改，
-- 硬塞進 task_json 會得到一個大部分欄位都空著的任務，
-- 也會污染教材庫與「今日任務」的查詢。它是不同的東西，就給它自己的表。

create table if not exists extensive_listens (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  language    text not null,
  title       text not null,
  script      text not null,
  topic       text,
  -- 生成時使用的程度（會比成員的學習程度低一級，見 prompts/extensive.ts）
  level       text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_extensive_profile_created
  on extensive_listens (profile_id, created_at desc);

alter table extensive_listens enable row level security;

drop policy if exists "anon full access extensive_listens" on extensive_listens;

create policy "anon full access extensive_listens"
  on extensive_listens for all to anon using (true) with check (true);
