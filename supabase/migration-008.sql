-- migration-008：台語模組（聽、說）
--
-- taiwanese_scripts 在 schema.sql 就有了，但當初只預留了 title / lines /
-- audio_urls。實際做下去發現還需要：
--   notes  台語詞筆記（漢字／台羅／華語）
--   level  難度（入門／日常／進階）
--   topic  情境，用來避免生成一堆重複的腳本
--
-- 可重複執行：整份再跑一次不會出錯、也不會產生重複資料。

-- 先確保表存在（沒跑過 schema.sql 的環境也能直接用這支）
create table if not exists taiwanese_scripts (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  lines      jsonb not null default '[]',
  audio_urls jsonb not null default '{}',
  created_at timestamptz not null default now()
);

alter table taiwanese_scripts add column if not exists notes jsonb not null default '[]';
alter table taiwanese_scripts add column if not exists level text;
alter table taiwanese_scripts add column if not exists topic text;

-- RLS：自用專案，anon 可讀寫全部（與 schema.sql 其餘表一致）
alter table taiwanese_scripts enable row level security;
drop policy if exists "anon full access taiwanese_scripts" on taiwanese_scripts;
create policy "anon full access taiwanese_scripts" on taiwanese_scripts
  for all to anon using (true) with check (true);

-- 首頁要依建立時間倒序列出腳本
create index if not exists taiwanese_scripts_created_idx on taiwanese_scripts (created_at desc);
