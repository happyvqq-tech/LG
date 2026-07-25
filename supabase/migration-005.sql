-- migration 005：古文模組（《古文觀止》學習進度）
-- 在 Supabase SQL Editor 執行一次即可（可重複執行）
-- 註：古文原文不進資料庫，隨程式動態載入，故此處只存進度

alter table profiles
  add column if not exists classical_level text;   -- 入門 / 基礎 / 進階 / 高階

create table if not exists classical_progress (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references profiles(id) on delete cascade,
  text_id          text not null,                  -- 對應 data/classicalIndex.ts 的 id（gw001…gw222）
  para_index       int  not null default 0,        -- 讀到第幾段
  punctuation_best real not null default 0,        -- 句讀最佳正確率 0-1
  translation_best int  not null default 0,        -- 翻譯最佳分數 0-100
  status           text not null default 'reading' check (status in ('reading', 'done')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (profile_id, text_id)
);

create index if not exists idx_classical_profile on classical_progress (profile_id, status);

alter table classical_progress enable row level security;
drop policy if exists "anon full access classical_progress" on classical_progress;
create policy "anon full access classical_progress" on classical_progress for all to anon using (true) with check (true);
