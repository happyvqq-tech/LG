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

// Google Cloud TTS（英文／日文／韓文的語音來源）
//
// 開著但沒設金鑰不會壞：前端第一次呼叫失敗就自動退回瀏覽器內建語音，
// 連續失敗三次後整個 session 都不再嘗試（見 googleTts.ts 的 FAILURE_LIMIT）。
// 所以這個開關預設是開的——有設金鑰的裝置直接享受到，沒設的維持原狀。
//
// 要啟用真正的 Google 語音：
//   1. GCP Console 建專案 → 啟用 Cloud Text-to-Speech API → 建 API 金鑰
//      （務必在金鑰設定裡限制成「只能呼叫 Text-to-Speech API」）
//   2. cd worker && npx wrangler secret put GOOGLE_TTS_API_KEY && npx wrangler deploy
//   3. 到 Worker 的 /health 確認 google_tts_key 顯示已設定
// 每月前 100 萬字元免費，家庭用量約 12 萬，記得還是去 GCP 設一個預算警示。
export const GOOGLE_TTS_ENABLED = true
