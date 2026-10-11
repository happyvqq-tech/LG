-- migration 013：歌曲學習（songs）
-- 在 Supabase SQL Editor 執行一次即可（可重複執行）
--
-- 為什麼不塞進 extensive_listens 或 tasks：歌曲有自己的東西——
-- 演唱者、分段進度、以及「這一行能不能拿去用」的逐行標註。
-- 硬塞進別的表會得到一堆空欄位，也會污染那些表的查詢。
--
-- ── 歌詞為什麼存在這裡 ─────────────────────────────────────
-- 歌詞是使用者自己從串流平台複製貼上的，存的是「這個家庭自己的一份副本」，
-- 不對外提供、不散布（見 LICENSE：本專案為家庭自用工具）。
-- 刻意不讓 AI 生成歌詞的原因在 worker/src/prompts/songPicker.ts 有說明：
-- 模型背的歌詞會錯，而教錯的歌詞比不教更糟。

create table if not exists songs (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references profiles(id) on delete cascade,
  language       text not null,
  title          text not null,
  artist         text not null,
  -- 使用者貼上的歌詞原文（教材的唯一事實來源）
  lyrics         text not null,
  -- songLesson 的輸出：summary + segments[]（逐行標註、語塊、連音縮讀）
  lesson         jsonb not null,
  -- 學到第幾段（0-based），回來可以接著上次的進度
  segment_index  int not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists idx_songs_profile_created
  on songs (profile_id, created_at desc);

alter table songs enable row level security;

-- 政策要跟其他表一致。migration-010 之後是「要帶通關密碼才行」，
-- 但還沒跑過 010 的資料庫沒有 app_access_ok() 這個函式，
-- 直接建會整支 SQL 失敗——所以先看函式在不在，再決定建哪一種。
do $$
begin
  drop policy if exists "anon full access songs" on songs;
  drop policy if exists "family only songs" on songs;

  if to_regprocedure('public.app_access_ok()') is not null then
    create policy "family only songs"
      on songs for all to anon using (app_access_ok()) with check (app_access_ok());
    raise notice '已套用 songs（通關密碼保護）';
  else
    -- 還沒跑 migration-010：沿用當時的預設行為，跑了 010 之後會被一併換掉
    create policy "anon full access songs"
      on songs for all to anon using (true) with check (true);
    raise notice '已套用 songs（尚未啟用通關密碼，建議之後跑 migration-010）';
  end if;
end $$;

-- ---------- 驗證 ----------
-- select count(*) from songs;   -- 應該回 0 而不是報錯
