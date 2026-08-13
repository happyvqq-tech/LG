-- migration 011：errors 加上 resolved_at（攻克時間）
--
-- 為什麼要這個欄位：新增的「進步存摺」頁要回答「你這個月修掉了幾個長期錯誤」，
-- 而原本的 errors 表只有 created_at（錯誤第一次出現的時間）跟 status。
-- 知道現在有 12 個 resolved，但不知道它們是這個月攻克的還是半年前的——
-- 而「這個月攻克了 3 個」正是整個存摺裡最值得看的那個數字。
--
-- 這支 SQL 是安全的：只加欄位、不動任何既有資料，跑幾次都一樣。
-- 沒跑也不會壞——前端偵測到欄位不存在會自動退回，只是存摺上的
-- 「攻克錯誤」不會有本期／上期的對照。
--
-- ⚠️ 既有的 resolved 錯誤會是 NULL，這是刻意的：
--    資料庫裡沒有留下它們是何時被攻克的，硬拿 created_at 去填等於捏造數據。
--    NULL 會被算成「不屬於任何期間」，只計入累積總數。往後新攻克的才有時間。

alter table errors add column if not exists resolved_at timestamptz;

-- 存摺會用「resolved_at 落在近 30 天」這種條件查，補一個索引
create index if not exists idx_errors_profile_resolved on errors (profile_id, resolved_at);

-- ---------- 驗證 ----------
-- 應該要看到 resolved_at 這一欄：
-- select column_name from information_schema.columns where table_name = 'errors';
