-- migration 015：影片學習（videos）
-- 在 Supabase SQL Editor 執行一次即可（可重複執行）
--
-- 跟 songs 分開一張表而不是共用：兩者的教材結構根本不同。
-- 歌曲逐行標「能不能拿去用」（旋律會扭曲語言）；影片標的是
-- 「這句用耳朵聽會不會跟字面差很遠」，另外還有填充詞與腔調。
-- 硬塞進同一張表會得到一堆互相空著的欄位。
--
-- ── 逐字稿為什麼是使用者貼的 ───────────────────────────────
-- YouTube 的 captions.download 只有影片擁有者能呼叫，非官方的 timedtext
-- 端點被鎖得很嚴而且是灰色地帶，第三方逐字稿 API 要錢。
-- 所以逐字稿一律來自 YouTube 自己的「顯示轉錄稿」面板，使用者複製貼上。
-- 存的是這個家庭自己的一份副本，不對外提供、不散布（見 LICENSE）。
--
-- 影片本身完全不代管，只存 11 碼的 YouTube 影片 ID，播放走官方嵌入。

create table if not exists videos (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references profiles(id) on delete cascade,
  language       text not null,
  title          text not null,
  -- YouTube 影片 ID（11 碼），不存網址——網址寫法太多種
  youtube_id     text not null,
  -- 使用者貼上的逐字稿原文（含時間戳時可做分段播放）
  transcript     text not null,
  -- videoLesson 的輸出：gist / accent / lines / reductions / fillers / chunks
  lesson         jsonb not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_videos_profile_created
  on videos (profile_id, created_at desc);

alter table videos enable row level security;

-- 政策跟其他表一致。還沒跑過 migration-010 的資料庫沒有 app_access_ok()，
-- 直接建會整支 SQL 失敗——先看函式在不在，再決定建哪一種。
do $$
begin
  drop policy if exists "anon full access videos" on videos;
  drop policy if exists "family only videos" on videos;

  if to_regprocedure('public.app_access_ok()') is not null then
    create policy "family only videos"
      on videos for all to anon using (app_access_ok()) with check (app_access_ok());
    raise notice '已套用 videos（通關密碼保護）';
  else
    create policy "anon full access videos"
      on videos for all to anon using (true) with check (true);
    raise notice '已套用 videos（尚未啟用通關密碼，建議之後跑 migration-010）';
  end if;
end $$;

-- ---------- 驗證 ----------
-- select count(*) from videos;   -- 應該回 0 而不是報錯
