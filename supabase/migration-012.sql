-- migration 012：profiles 加上 interests（興趣與近況）
--
-- 為什麼要這個欄位：任務生成的情境目前只從固定的六個類別（校園／日常／旅遊／
-- 職場／新聞時事／科技）隨機挑，所以四個家人拿到的教材本質上長得一樣。
-- 但 AI 生成最大的優勢就是無限個人化——「下個月要去大阪」跟「最近在追某部日劇」
-- 這種資訊，可以讓同樣是「旅遊」的情境變成真的跟你有關的內容。
--
-- 成人學習者對「跟自己有關的材料」的投入度遠高於通用教材，這是語言教學裡
-- 少數沒有爭議的結論。這個欄位就是把那件事接起來。
--
-- 這支 SQL 是安全的：只加欄位、不動既有資料，跑幾次都一樣。
-- 沒跑也不會壞——前端存檔時偵測到欄位不存在會自動退回（少存這一欄），
-- 只是任務不會個人化。

alter table profiles add column if not exists interests text;

-- ---------- 驗證 ----------
-- 應該要看到 interests 這一欄：
-- select column_name from information_schema.columns where table_name = 'profiles';
