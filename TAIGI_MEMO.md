# 台語模組備忘（目前關閉中）

程式、資料庫 migration、測試都完成了，但**預設關閉**，使用者選不到台語。
要開啟只需改一個常數 ＋ 兩個外部設定，細節見下方「怎麼重新開啟」。

關閉的原因：台語發音只能靠付費的雅婷 TTS，每合成一句就花點數。
在還沒決定要不要用之前先關起來，免得家人選了台語卻只看到
「台語語音服務暫時無法使用」。

---

## 1. 怎麼重新開啟

```ts
// src/lib/features.ts
export const TAIGI_ENABLED = true   // 改成 true
```

改完之後還要做兩件事，缺一台語都不會動：

**（a）雅婷金鑰**

到 <https://developer.yating.tw> 註冊 → Dev Console 建一把 API key
（新會員送等值 NT$1,000 試用點數），然後：

```bash
cd worker
npx wrangler secret put YATING_API_KEY
npx wrangler deploy
```

驗證：打開 `https://<你的worker網址>/health`，應看到
`"yating_key": "已設定（xx 字元）"`。

**（b）資料庫欄位**

Supabase → SQL Editor → 貼上 `supabase/migration-008.sql` → Run。
這支只是幫 `taiwanese_scripts` 補 `notes` / `level` / `topic` 三個欄位，
可以重複執行。

> Worker 端的 `/api/tts` 一直都在，即使 `TAIGI_ENABLED = false` 也是。
> 沒設 `YATING_API_KEY` 的話它會回一個明確的錯誤，不會影響 `/api/chat`。

---

## 2. 範圍：只有「聽」與「說」

不做讀與寫，這是刻意的：

- **讀**：台語沒有夠份量的分級閱讀材料，硬生只會生出一堆「用台語寫的華語文章」
- **寫**：台文漢字用字（教育部推薦用字）連母語者都常寫錯，AI 批改的可信度不夠，
  給錯的訂正比不給還糟

如果之後想補，**「聽寫」是可行的**：聽一句、寫出漢字、跟正確答案比對。
這條路不需要 AI 判斷對錯，沒有可信度問題。

---

## 3. 發音來源：雅婷 TTS

瀏覽器的 `speechSynthesis` 沒有台語語音。`speech.ts` 裡 `LANG_CODE.台語`
對應到 `zh-TW` 只是佔位值（那是國語），台語一律不走那條路。

| 項目 | 值 |
|---|---|
| 端點 | `POST https://tts.api.yating.tw/v2/speeches/short` |
| 認證 | header `key: <YATING_API_KEY>` |
| 音色 | `tai_female_1`（雅婷）、`tai_female_2`（意晴）、`tai_male_1`（家豪） |
| 語速 | `0.5` ~ `1.5`（超出會被上游擋掉，前端已先夾住） |
| 回應 | `{ audioContent: "<base64 mp3>" }` |

**Worker 端（`worker/src/index.ts` 的 `/api/tts`）做的事：**

- 金鑰只存在 Worker secret，前端拿不到
- 回傳的是 `audio/mpeg` 位元組，不是 base64 JSON（前端直接做 blob URL）
- 用 Cloudflare Cache 依「句子＋音色＋語速」快取一年——同一句重聽、
  換裝置聽都不再計費，**快取命中不計入限流也不碰上游**
- model 白名單（不在清單的退回預設女聲）、單次 200 字上限、語速夾在 0.5~1.5
- TTS 限流 60 次/分鐘，跟聊天的 20 次/分鐘**分開計算**
  （一段腳本逐句合成，共用額度會在正常使用下就被擋掉）

**前端（`src/lib/taigiTts.ts`）：**
分頁內再一層 blob 快取；`preloadTaigi()` 只多抓一句
（抓太多而使用者中途離開就是白花錢）。

---

## 4. 跟讀評分：比語調，不比用字

**台語沒有語音辨識可用。** 英日韓的跟讀（`prosodyScore.ts`）是靠瀏覽器
`SpeechRecognition` 把使用者說的話轉成文字再比對，但它沒有台語；
硬用 `zh-TW` 會辨識成一堆不相干的國語詞，分數毫無意義。

所以台語改成**直接比兩段錄音的聲音本身**（`src/lib/audioProsody.ts`）：

1. **音高追蹤** — 正規化自相關，人聲基頻 70~400Hz。
   有一個 `+0.02` 的 margin 防止測到週期的 2 倍（低八度誤判）——
   少了它，音高會隨機掉一個八度，半音曲線整段偏 12 個半音，分數完全不能看。
2. **半音曲線** — 音高換算成「相對自己中位數的半音數」。
   **這步是整套能不能用的關鍵**：AI 是女聲、使用者可能是男聲，基頻差一個八度以上；
   比絕對頻率的話唸得再像都是零分。轉成相對起伏之後，男聲跟著女聲唸出同樣的
   抑揚就能拿高分——這才是跟讀要練的東西。
3. **DTW 對齊** — 允許時間軸伸縮，唸慢一點不扣語調分。
4. **綜合分數** — `pitchSim × (0.65 + 0.25×rhythmSim + 0.10×durationSim)`。
   語調是**乘數不是加項**：原本三項相加時，測試抓到「節奏與長度對上、
   語調完全沒跟」也能拿 85 分。改成乘法後語調不像就整體壓低。
5. 過關門檻 80 分，與英日韓一致；連續兩次不過會出現「跳過這句」。

錄音會留著，畫面上可以「聽 AI ↔ 聽自己」A/B 對照——這是分數給不了的回饋。
UI 明講「比的是語調與節奏像不像，不是用字對不對」，不要讓人誤會這是發音正確度。

48kHz 的手機錄音會先降取樣到 16kHz 再做音高分析（`downsampleTo`），
不然自相關要慢上快十倍，按完「唸完了」要等好幾秒。

---

## 5. 檔案清單

| 檔案 | 作用 |
|---|---|
| `src/lib/features.ts` | **開關在這裡** |
| `worker/src/index.ts` | `/api/tts` 代理與快取 |
| `src/lib/taigiVoice.ts` | 音色清單、語速夾制、偏好存取（純函式） |
| `src/lib/taigiTts.ts` | 呼叫 Worker、blob 快取、播放 |
| `src/lib/audioProsody.ts` | 語調節奏評分（純函式） |
| `src/lib/audioCapture.ts` | 錄音與音檔解碼（`audioProsody` 的 IO 外殼） |
| `src/lib/prompts/taigiScript.ts` | 腳本生成 prompt 與 JSON 驗證 |
| `src/lib/taigiService.ts` | `taiwanese_scripts` CRUD ＋ 跟讀進度（localStorage） |
| `src/pages/TaigiHome.tsx` | 腳本庫、音色挑選、生成 |
| `src/pages/TaigiListening.tsx` | 逐句播放，漢字／台羅／華語各自開關 |
| `src/pages/TaigiShadowing.tsx` | 逐句跟讀評分 |
| `supabase/migration-008.sql` | `notes` / `level` / `topic` 欄位 |

`TAIGI_ENABLED = false` 時，路由與入口都不會掛上去，
上面這些頁面元件會被 Vite tree-shake 掉大部分，不影響其他語言。

---

## 6. 已知限制

- **成本**：每句每種音色每種語速各算一次。同一句換速度重聽要重新付費
  （快取鍵包含語速）。試用點數用完就要儲值。
- **語速上限 1.5**：站上有 2.0 這一檔，台語會自動夾到 1.5 並在畫面上說明。
- **腳本用字靠 AI**：prompt 有要求教育部推薦用字與台羅，用 `claude-sonnet-4-6`
  而不是 haiku，但仍可能出現用字爭議。腳本可以刪掉重生。
- **腳本是全家共用的**（`taiwanese_scripts` 沒有 `profile_id`），
  進度才是個人的（存 localStorage）。這是刻意的：台語腳本是可重複聽的教材，
  沒必要每個人各生一份燒點數。

---

## 7. 測試

關閉狀態下這些測試仍然可跑（純函式不受開關影響）：

```bash
npx tsx <scratchpad>/taigitest.ts      # 48 項純函式（音高、半音曲線、DTW、評分邊界）
npx tsx <scratchpad>/workertest.mts    # 21 項 Worker 行為（快取、金鑰不外洩、限流、錯誤翻譯）
```

端對端煙霧測試 `taigi_smoke.mjs` 需要把 `TAIGI_ENABLED` 改回 `true` 再 build 才能跑。
