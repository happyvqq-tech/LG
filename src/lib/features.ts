// 功能開關
//
// 台語模組（聽＋跟讀）程式碼是完整的、測試也都過，但需要雅婷 TTS 的金鑰
// 才會有聲音，而且每合成一句就要花點數。在還沒決定要不要用之前先關起來，
// 免得家人選了台語卻只看到「語音服務無法使用」。
//
// 要重新開啟：把 TAIGI_ENABLED 改成 true，然後
//   1. 到 developer.yating.tw 申請金鑰
//   2. cd worker && npx wrangler secret put YATING_API_KEY && npx wrangler deploy
//   3. Supabase SQL Editor 跑 supabase/migration-008.sql
// 細節見 TAIGI_MEMO.md。
export const TAIGI_ENABLED = false
