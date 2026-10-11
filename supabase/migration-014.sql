-- migration 014：歌曲加上同步歌詞與原曲影片
--
-- 兩個欄位都是為了同一件事：**只循環播這一段**。
--
-- 學一首歌真正有效的練法不是從頭聽到尾，是把十幾秒的一句反覆聽到嘴巴跟得上。
-- 那需要知道每一句從第幾秒開始（synced），也需要一個放得出聲音的來源（youtube_id）。
--
-- synced 存的是 LRC 格式原文（[mm:ss.xx] 每行一句），由 LRCLIB 自動帶回來。
-- 解析在前端做（lib/lrc.ts），存原文而不是存解析結果是因為格式可能要重新詮釋，
-- 原文留著就不必重抓。
--
-- youtube_id 只存影片 ID，不存網址——網址有太多種寫法（youtu.be、
-- 帶 playlist 參數、帶 t= 時間），存 ID 最乾淨。影片本身在 YouTube 上播，
-- 我們不存也不代管任何音檔。
--
-- 這支 SQL 是安全的：只加欄位、不動既有資料，跑幾次都一樣。
-- 沒跑也不會壞——沒有這兩欄就只是沒有分段播放，逐行教材照常可用。

alter table songs add column if not exists synced     text;
alter table songs add column if not exists youtube_id text;

-- ---------- 驗證 ----------
-- select column_name from information_schema.columns where table_name = 'songs';
