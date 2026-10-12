-- migration 016：文章學習（articles）
-- 在 Supabase SQL Editor 執行一次即可（可重複執行）
--
-- 為什麼不跟 videos 或 extensive_listens 共用：教材結構不同。
-- 泛聽是 AI 生成、刻意低於程度、只有一段 script；
-- 影片標的是「這句聽起來跟字面差多少」；
-- 文章標的是「為什麼你讀不動」——長句解剖、指涉鏈、書面轉口語。
-- 硬塞在一起會得到一堆互相空著的欄位。
--
-- ── 原文從哪裡來 ───────────────────────────────────────────
-- 使用者自己貼，或由 Worker /api/article 依網址抓一次。
-- AI 絕不重打原文（理由同歌詞與逐字稿：模型憑印象改寫過的引用，
-- 學習者在文章裡找不到那一句，整份教材就失去依據）。
-- 存的是這個家庭自己的一份副本，不對外提供、不散布（見 LICENSE）。
--
-- body 已經在前端截到 3000 字元才存——存進來的跟送進 prompt 的必須是
-- 同一份，否則教材會講到畫面上沒有的句子。

create table if not exists articles (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null references profiles(id) on delete cascade,
  language       text not null,
  title          text not null,
  -- 來源網址；直接貼文字時為 null
  source_url     text,
  -- 原文本體
  body           text not null,
  -- articleLesson 的輸出：gist / register / sentences / refs / spoken / connectives / chunks
  lesson         jsonb not null,
  created_at     timestamptz not null default now()
);

create index if not exists idx_articles_profile_created
  on articles (profile_id, created_at desc);

alter table articles enable row level security;

-- 政策跟其他表一致。還沒跑過 migration-010 的資料庫沒有 app_access_ok()，
-- 直接建會整支 SQL 失敗——先看函式在不在，再決定建哪一種。
do $$
begin
  drop policy if exists "anon full access articles" on articles;
  drop policy if exists "family only articles" on articles;

  if to_regprocedure('public.app_access_ok()') is not null then
    create policy "family only articles"
      on articles for all to anon using (app_access_ok()) with check (app_access_ok());
    raise notice '已套用 articles（通關密碼保護）';
  else
    create policy "anon full access articles"
      on articles for all to anon using (true) with check (true);
    raise notice '已套用 articles（尚未啟用通關密碼，建議之後跑 migration-010）';
  end if;
end $$;

-- ---------- 驗證 ----------
-- select count(*) from articles;   -- 應該回 0 而不是報錯
