-- migration 010：把 RLS 從「任何人都能讀寫」改成「要帶通關密碼才行」
--
-- ⚠️ 跑之前先讀完這段，順序做錯會把自己鎖在外面。
--
-- 這是在補一個真實的洞：原本每張表的政策都是
--     for all to anon using (true) with check (true)
-- 也就是「anon 角色可以對所有列做任何事，沒有任何條件」。而 anon key 就寫在
-- 前端 JS 裡（那是設計內公開）。結果是：任何人拿到網址 → 從 JS 撈出 anon key
-- → 一行 curl 就能讀走、改掉、甚至刪光全家的學習資料。不需要通過網頁介面。
--
-- 補法：沿用已經有的「全家共用通關密碼」（ACCESS_PASSPHRASE，見
-- ACCESS_GATE_MEMO.md）。前端每個 Supabase 請求都會夾帶 x-lgl-access header
-- （lib/supabase.ts），policy 比對它跟資料庫裡存的密碼一不一樣。
--
-- 這樣做的關鍵好處：密碼不在打包出去的 JS 裡，是使用者自己輸入後存在
-- localStorage 的。所以看原始碼拿不到它。
--
-- ── 限制（誠實說明）─────────────────────────────────────────
-- 這不是帳號系統，全家共用一組密碼，沒有個人身份，也擋不住知道密碼的人。
-- 它擋的是「網址／原始碼外流之後，陌生人直接打資料庫」。
-- 要做到「每個家人只能看自己的資料」需要 Supabase Auth，那會動到整個
-- 架構（CLAUDE.md 第 10 節明訂不做登入系統），不在這次範圍。
--
-- ── 正確順序 ───────────────────────────────────────────────
-- 1. 先部署前端（這個 PR）—— 讓前端會夾帶 header
-- 2. 再設 Worker secret：wrangler secret put ACCESS_PASSPHRASE && wrangler deploy
-- 3. 開網站，輸入密碼一次（存進 localStorage）
-- 4. 最後才跑這支 SQL，密碼要跟第 2 步設的完全一樣
--
-- 順序顛倒的話（先跑 SQL 但還沒輸入密碼），畫面會變成讀不到任何成員，
-- 看起來像資料不見了——其實資料還在，只是被擋住。照上面的順序補做即可。
-- 真的鎖住出不來，用本檔最後面的「緊急還原」那段。

-- ---------- 1. 密碼存放處：一張 anon 完全讀不到的表 ----------
--
-- 為什麼不把密碼寫死在下面那個函式裡：這個檔案會進 git，而 repo 是公開的。
-- 存進表裡的話，密碼只存在你的資料庫，不會被 commit 出去。
create table if not exists app_secrets (
  key   text primary key,
  value text not null
);

alter table app_secrets enable row level security;

-- 刻意不建立任何 policy：RLS 開著又沒有 policy＝anon 一列都讀不到。
-- 只有下面那個 security definer 函式（以擁有者身分執行）讀得到。
drop policy if exists "anon full access app_secrets" on app_secrets;

-- ---------- 2. 設定你的通關密碼 ----------
--
-- ⚠️ 把 '請改成你的通關密碼' 換成你在 wrangler secret put ACCESS_PASSPHRASE
--    設的那一組，兩邊必須完全一樣（含大小寫，不要多空白）。
insert into app_secrets (key, value)
values ('access_passphrase', '請改成你的通關密碼')
on conflict (key) do update set value = excluded.value;

-- ---------- 3. 檢查函式 ----------
--
-- security definer：以函式擁有者的身分執行，才讀得到 anon 讀不到的 app_secrets。
-- set search_path：security definer 函式的標準防護，避免被換掉 schema 搞劫持。
-- PostgREST 會把 HTTP header 放進 request.headers（名稱一律小寫）。
create or replace function app_access_ok()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
           current_setting('request.headers', true)::json ->> 'x-lgl-access',
           ''
         ) = (select value from app_secrets where key = 'access_passphrase');
$$;

-- ---------- 4. 換掉所有「任何人都能存取」的政策 ----------
do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'tasks', 'errors', 'grammar_points',
    'vocab_cards', 'vocab_quizzes', 'activity_log', 'particle_cards',
    'taiwanese_scripts', 'classical_progress', 'extensive_listens'
  ];
begin
  foreach t in array tables loop
    -- 表可能還沒建（例如沒跑過 migration-009），跳過就好，不要整支 SQL 失敗
    if to_regclass('public.' || t) is null then
      raise notice '略過 %（這張表還不存在）', t;
      continue;
    end if;

    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "anon full access %s" on %I', t, t);
    execute format('drop policy if exists "family only %s" on %I', t, t);
    execute format(
      'create policy "family only %s" on %I for all to anon using (app_access_ok()) with check (app_access_ok())',
      t, t
    );
    raise notice '已套用 %', t;
  end loop;
end $$;

-- ---------- 5. 驗證 ----------
--
-- 這行在 SQL Editor 裡會回 false（SQL Editor 不是 PostgREST，沒有 request.headers）。
-- 那是正常的，不代表設錯。真正的驗證方式是打開網站看資料讀不讀得到。
-- select app_access_ok();

-- ---------- 換密碼 ----------
--
-- 兩邊都要改，而且要一樣：
--   1. update app_secrets set value = '新密碼' where key = 'access_passphrase';
--   2. cd worker && npx wrangler secret put ACCESS_PASSPHRASE && npx wrangler deploy
-- 所有裝置下次操作時會被登出，重新輸入新密碼即可。

-- ---------- 緊急還原（把自己鎖在外面時用）----------
--
-- 把下面整段解除註解執行，就會回到「任何人都能存取」的原始狀態。
-- 這會重新打開那個洞，只在排除問題時暫時使用。
--
-- do $$
-- declare
--   t text;
--   tables text[] := array[
--     'profiles', 'tasks', 'errors', 'grammar_points',
--     'vocab_cards', 'vocab_quizzes', 'activity_log', 'particle_cards',
--     'taiwanese_scripts', 'classical_progress', 'extensive_listens'
--   ];
-- begin
--   foreach t in array tables loop
--     if to_regclass('public.' || t) is null then continue; end if;
--     execute format('drop policy if exists "family only %s" on %I', t, t);
--     execute format(
--       'create policy "anon full access %s" on %I for all to anon using (true) with check (true)',
--       t, t
--     );
--   end loop;
-- end $$;
