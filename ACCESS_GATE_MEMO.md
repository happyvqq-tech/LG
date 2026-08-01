# 通關密碼備忘（選配功能）

全家共用一組密碼，擋在 Cloudflare Worker 的 `/api/chat`、`/api/gtts`、`/api/tts` 前面，
以及 Supabase 的所有資料表（migration-010）。
**這不是帳號系統**——沒有 email、沒有註冊、沒有後台審核、沒有個別使用者資料，
純粹是「知道密碼才能用會花錢的 API」。沒設定就是預設狀態：跟這個功能存在之前
完全一樣，任何人拿到網址都能直接用。

---

## 1. 為什麼做這個

CLAUDE.md 第 10 節明講不做登入/註冊/多租戶——這個功能刻意設計成
不踩到那條線：

- 沒有使用者帳號，只有一組全家共用的密碼
- 不擋 Supabase（本來就是設計內公開，見下方第 4 節）
- 目的單一：網址不小心外流（截圖、分享、瀏覽器紀錄同步）之後，
  陌生人不能拿去打 Anthropic／雅婷的付費額度

如果之後真的需要「每個人各自登入＋我後台審核」的完整方案（原本考慮過的
Option B：Supabase Auth + email 白名單），這份 memo 不涵蓋，需要另外設計，
會動到 Supabase schema 與 RLS。

---

## 2. 技術設計

```
瀏覽器                          Cloudflare Worker
  │  localStorage 存密碼           │
  │                                │
  ├─ POST /api/verify-access ────→ │  比對 header 與 ACCESS_PASSPHRASE
  │  ←──── 200 / 401 ──────────────┤
  │                                │
  ├─ POST /api/chat  (帶密碼) ────→ │  同樣的比對，擋在限流檢查之前
  └─ POST /api/tts   (帶密碼) ────→ │  （台語功能關閉中，但這條路徑一樣有效）
```

- Header 名稱 `x-lgl-access`，前端（`src/lib/claude.ts`、`src/lib/taigiTts.ts`）
  與後端（`worker/src/index.ts`）三處都要一致
- **完全 opt-in**：Worker 沒設 `ACCESS_PASSPHRASE` 這個 secret 時，
  `hasAccess()` 直接回傳 `true`，等於沒有這層檢查，行為與功能存在前完全相同
- 前端探測（`probeAccessGateNeeded()`，不帶密碼呼叫 `/api/verify-access`）：
  沒開通關密碼的部署會探測成功，`AccessGate` 元件直接放行，
  使用者完全不會看到輸入密碼的畫面——**沒選過這個功能的家庭不受任何影響**
- 密碼存在裝置的 `localStorage`（`src/lib/accessGate.ts`），輸對一次後
  這台裝置不用每次都輸入；換裝置、換瀏覽器要重新輸入
- 密碼被後端拒絕（`401` + `error: "access_denied"`）時：`claude.ts` 與
  `taigiTts.ts` 會自動清掉本機存的密碼並重新整理頁面，直接回到輸入畫面，
  不會卡在一句看不懂的「AI 服務錯誤」
- Worker 的 `/health` 端點會顯示目前是否設定了通關密碼，方便排查

---

## 3. 設定／換密碼／關閉

**設定：**

```bash
cd worker
npx wrangler secret put ACCESS_PASSPHRASE
npx wrangler deploy
```

**換密碼：** 重新 `wrangler secret put ACCESS_PASSPHRASE` 蓋掉舊的再
`wrangler deploy`。所有裝置下次呼叫 AI 功能時會收到 401，自動被登出、
跳回輸入畫面。

**關閉（回到完全不設防）：**

```bash
npx wrangler secret delete ACCESS_PASSPHRASE
npx wrangler deploy
```

不需要改前端任何程式碼或重新部署 GitHub Pages——`AccessGate` 元件下次
探測就會發現沒開通關密碼，直接放行。

---

## 4. 已知限制

- ~~**不保護 Supabase**~~ —— **已於 migration-010 補上**。
  原本這裡寫的是「有心人拿到 anon key 就能直接打 Supabase，這道密碼擋不住，
  是刻意的取捨」。後來認定那個取捨不成立：RLS 政策是
  `for all to anon using (true)`，等於任何人都能讀走、改掉、**刪光**全家的
  學習資料，這比 API 額度被盜用嚴重得多。
  `supabase/migration-010.sql` 把政策改成比對同一組通關密碼
  （前端每個請求夾帶 `x-lgl-access`，見 `src/lib/supabase.ts`）。
  關鍵是密碼不在打包出去的 JS 裡——它是使用者輸入後存在 localStorage 的，
  所以看原始碼拿不到。
- **只防外流，不防惡意內部成員**：全家共用同一組密碼，沒有個人身份，
  沒辦法知道是誰在用、也沒辦法只擋某一個人。
- **前端仍會打包出 Worker 網址**：`VITE_WORKER_URL` 一樣在前端可見，
  這是預期行為——密碼是擋在網址「之後」，不是藏網址本身。
- **限流仍然共用**：通關密碼跟原本「同 IP 每分鐘 N 次」的限流是兩層
  獨立機制，不互相取代。

---

## 5. 檔案清單

| 檔案 | 作用 |
|---|---|
| `worker/src/index.ts` | `hasAccess()` 檢查、`/api/verify-access`、`ACCESS_HEADER` 常數 |
| `src/lib/accessGate.ts` | localStorage 存取（純函式） |
| `src/lib/claude.ts` | 夾帶密碼 header、`verifyAccessPassphrase()`、`probeAccessGateNeeded()`、401 自動登出 |
| `src/lib/taigiTts.ts` | 台語 TTS 請求同樣夾帶密碼與 401 處理（台語功能關閉中，程式碼保留） |
| `src/components/AccessGate.tsx` | 包住整個 App 的守門元件，開站時探測／驗證 |
| `src/main.tsx` | 掛載 `AccessGate` 於最外層 |
