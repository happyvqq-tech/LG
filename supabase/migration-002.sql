-- migration 002：成員照片 + 每日學習計畫 + 初級（A2）程度
-- 在 Supabase SQL Editor 執行一次即可（可重複執行）

alter table profiles
  add column if not exists avatar_url text,
  add column if not exists daily_plan jsonb;

-- avatar_url：壓縮後的 data URL（256px JPEG，約 10-25KB）
-- daily_plan：{"time":"20:00","minutes":15,"days":[1,2,3,4,5]}（days 0=週日 … 6=週六）

comment on column profiles.avatar_url is '成員照片 data URL';
comment on column profiles.daily_plan is '每日學習計畫 {time, minutes, days}';
