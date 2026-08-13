# CLAUDE.md — 家庭語言學習 PWA（專案規則檔）

> 本檔案放在 repo 根目錄。Claude Code 執行任何指令前，先閱讀本檔全文並遵守所有規範。

---

## 1. 專案概述

自用家庭語言學習 Web App（PWA），不對外販售、不做商業功能。

- **語言範圍**：英文（聽說讀寫）、日文（聽說讀寫）、韓文（聽說讀寫）、古文（句讀／字詞／翻譯，獨立模組）
- **台語**：程式與測試已完成（只有聽、說，語音來自雅婷 TTS），但**預設關閉**，開關在 `src/lib/features.ts`，細節見 `TAIGI_MEMO.md`
- **使用者**：2～4 位家庭成員，程度 B1+ 起跳（高中以上）
- **核心理念**：任務式循環（聽 → 讀 → 說 → 寫）＋ 個人錯誤記憶庫 ＋ 文法點驅動
- **無登入系統**：首頁選擇成員即可，不做帳號密碼、不做付費、不做多租戶
- **授權**：公開 repo 但保留一切權利（見 `LICENSE`）。不是開源專案，
  不接受外部貢獻，也不要在程式碼或文件裡加上任何開源授權標頭
- **通關密碼**：全家共用一組密碼，擋在 Worker 的付費端點（`/api/chat`、`/api/gtts`、
  `/api/tts`）與 Supabase 所有資料表（RLS，migration-010）前面。不是帳號系統，
  沒有個人身份，目的是「網址或原始碼外流後，陌生人不能盜用額度、也不能讀寫全家的資料」，
  見 `ACCESS_GATE_MEMO.md`

## 2. 技術棧（不可擅自更換）

| 層 | 技術 |
|---|---|
| 前端 | React 18 + Vite + TypeScript + Tailwind CSS |
| PWA | vite-plugin-pwa（可安裝、離線 shell） |
| 部署（前端） | GitHub Pages（gh-pages branch 或 Actions） |
| 後端 | Cloudflare Workers（唯一職責：藏 API key、轉發 Claude API、簡單限流） |
| 資料庫 | Supabase 免費版（PostgreSQL），前端用 anon key 直連；RLS 以通關密碼把關（migration-010） |
| AI | Anthropic Claude API（模型見第 5 節） |
| 英日韓語音（TTS） | Google Cloud TTS（`texttospeech.googleapis.com`），經 Worker `/api/gtts` 代理，key 存 Worker secret；不可用時自動退回 speechSynthesis |
| 古文語音・所有 STT | 瀏覽器內建：speechSynthesis（TTS）、SpeechRecognition（STT） |
| 台語語音 | 雅婷 TTS（`tts.api.yating.tw`），經 Worker `/api/tts` 代理，key 存 Worker secret |

## 3. 架構

```
瀏覽器 PWA (GitHub Pages)
   ├── Supabase JS client ──→ Supabase（profiles / tasks / errors / grammar_points）
   ├── fetch ──→ Cloudflare Worker /api/chat ──→ api.anthropic.com /v1/messages
   ├── fetch ──→ Cloudflare Worker /api/gtts ──→ texttospeech.googleapis.com（英日韓語音，含快取）
   └── fetch ──→ Cloudflare Worker /api/tts  ──→ tts.api.yating.tw（台語語音，含快取）
                     （API key 存在 Worker 環境變數，絕不出現在前端程式碼）
```

## 4. 目錄結構

```
/
├── CLAUDE.md
├── BUILD_STEPS.md          # 分步指令包
├── worker/                 # Cloudflare Worker（獨立 wrangler 專案）
│   ├── src/index.ts
│   ├── src/prompts/        # 全部 15 個 system prompt 與模型選擇（見第 6 節）
│   └── wrangler.toml
├── src/
│   ├── pages/              # MemberSelect / TaskHome / Listening / Reading /
│   │                       # Speaking / Writing / Rewrite / Feedback / GrammarDrill / Taiwanese
│   │                       # TaskArchive / TaskReview（教材庫：翻閱過去任務複習，唯讀）
│   │                       # BackTranslate（回譯：看中文產出目標語，再跟原句比對）
│   │                       # Fluency（流利度 4/3/2：同段話講三次，時間遞減）
│   │                       # ExtensiveHome / ExtensivePlayer（泛聽：長而簡單，只聽不練）
│   │                       # Progress（進步存摺：累積量、本期vs上期、成長曲線、練習足跡、里程碑）
│   ├── components/
│   ├── lib/
│   │   ├── claude.ts       # 呼叫 Worker 的統一封裝（含 JSON 解析與重試）
│   │   ├── supabase.ts
│   │   ├── speech.ts       # TTS/STT 統一入口（自動在 Google 與瀏覽器語音之間選擇）
│   │   ├── googleTts.ts    # Google Cloud TTS 播放層（快取、預抓、失敗退回）
│   │   ├── googleVoices.ts # Google 音色分級與排序（純函式）
│   │   ├── reviewSchedule.ts # 教材間隔重聽排程 1/3/7/14/30 天（純函式）
│   │   ├── celebrationRules.ts # 任務完成結算的主標優先序與里程碑判定（純函式）
│   │   ├── familyRules.ts  # 全家一週摘要：分散點名、不做反向排名（純函式）
│   │   ├── familyService.ts # 全家一週狀態（四張表各查一次，避免 N+1）
│   │   ├── progressRules.ts # 進步存摺的分期、累積、熱力圖、里程碑計算（純函式）
│   │   ├── progressService.ts # 進步存摺的資料讀取（五張表一次撈，不呼叫 AI）
│   │   ├── readingAidService.ts # 日文假名／韓文實際發音的按需標註與快取
│   │   ├── ruby.ts         # [漢字|かな] 標記解析（純函式）
│   │   └── prompts/        # 只剩「輸入介面 + 回應驗證函式」；
│   │                       # system prompt 本文在 worker/src/prompts/（見第 6 節）
│   └── data/
│       └── grammar_points.ts  # 高中核心文法點種子清單
└── supabase/schema.sql
```

## 5. AI 模組與模型配置

| 模組 | 模型字串 | 用途 | 輸出 |
|---|---|---|---|
| 任務生成器 | `claude-sonnet-4-6` | 生成每日任務（情境、聽力稿、語塊、口說目標、寫作題）；教材要反覆聽讀，連貫性優先，2026-08 從 haiku 升級 | JSON |
| 對話角色 | `claude-haiku-4-5` | 口說練習的對手，多輪對話 | 純文字 |
| 批改回饋器 | `claude-sonnet-4-6` | 寫作批改、錯誤分類、文法微課、快練出題 | JSON |
| 週報生成器 | `claude-sonnet-4-6` | 讀錯誤庫，生成避坑指南 | Markdown |
| 台語腳本生成 | `claude-sonnet-4-6` | 生成台語腳本（漢字／台羅／華語三對照） | JSON |

- API 端點：`POST https://api.anthropic.com/v1/messages`，headers：`x-api-key`、`anthropic-version: 2023-06-01`、`content-type: application/json`
- 官方文件：https://docs.claude.com/en/api/overview
- **凡要求 JSON 輸出的模組**：system prompt 必須明確要求「只輸出 JSON，不加任何前言與 markdown 圍欄」；前端 `claude.ts` 仍需做圍欄剝除與 try-catch 解析，解析失敗自動重試一次
- max_tokens：對話 1024、任務生成 3000、批改 3000、週報 2000、台語腳本 3000

## 6. Prompt 模組（完整內容）

以下為四個核心模組的 system prompt 基準版本。**實作放在 `worker/src/prompts/`**，可微調但不得刪除核心要求。

### prompt 為什麼在 Worker 而不在前端

前端的 JS 一定會下載到訪客瀏覽器。prompt 放前端時，任何人按 F12 搜關鍵字就能把
全部 15 個模組的完整內容複製走——不用 clone repo。而這個專案真正花過腦子的就是
prompt 設計，React 元件反而是通用零件。搬到 Worker 之後瀏覽器只看得到模組名與變數。

附帶好處：改 prompt 只要 `wrangler deploy`（約 5 秒），不用重跑整個前端 build；
模型選擇也一併搬過去，前端不再能指定 `model`。

**分工**：`worker/src/prompts/` 放 system prompt 本文與模型/max_tokens；
`src/lib/prompts/` 只留「輸入介面」（讓呼叫端有型別可依）與「回應驗證函式」
（解析用，不是機密）。新增模組時兩邊都要加，並在 `worker/src/prompts/index.ts`
的 `PromptModule` 與 `src/lib/claude.ts` 的同名型別登錄。

### 6.1 任務生成器（taskGenerator）

```
你是語言學習任務設計師。根據以下輸入生成一個 8-15 分鐘的任務式學習循環。

輸入變數：
- 語言：{英文|日文}
- 程度：{B1|B2|C1}
- 情境類別：{隨機從成員的情境池挑選，或指定}
- 本週文法點：{grammar_points 陣列，1-2 個}
- 待驗證錯誤：{errors 表中 status='pending_verify' 的 3 筆以內}

硬性要求：
1. 聽力稿 150-250 字，口語自然，必須自然融入指定文法點至少 3 次
2. 若有待驗證錯誤，必須在對話任務或寫作題中刻意設計會用到該句型的情境（不明說）
3. 語塊（chunks）給 5-8 個，是可整段套用的單位、不是單字。三個語言的「可套用單位」不同：
   英文＝搭配詞與片語動詞；日文＝文型（〜わけにはいかない 這類）；韓文＝連結語尾與慣用句型
4. 寫作題必須與情境直接相關，30-80 字即可完成
5. 日文的語體跟著人物關係走，不設全域預設：對朋友家人用普通体、對店員上司用丁寧体，
   並讓同一篇裡自然出現切換。不用尊敬語／謙譲語造句給學習者模仿。詳見
   `worker/src/prompts/japaneseRegister.ts`（那支說明了為什麼普通体才是地基）

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "scenario_title": "",
  "scenario_desc": "",
  "listening_script": "",
  "chunks": [{"text": "", "zh": "", "usage": ""}],
  "speaking_goal": "",
  "speaking_role_setup": "AI 扮演的角色與立場",
  "writing_prompt": "",
  "grammar_points_used": []
}
```

### 6.2 對話角色（dialogPartner）

```
你是任務中的角色：{speaking_role_setup}。與使用者用{語言}進行口語對話。

規則：
1. 每次回覆 1-3 句，口語化，符合角色立場，不跳出角色
2. 使用者的目標是：{speaking_goal}。你不要輕易讓目標達成，適度提出條件或疑問（1-2 輪拉鋸即可）
3. 使用者卡關（回覆 "HINT_REQUEST"）時：不給完整答案，給句型框架或字首提示，然後繼續對話
4. 使用者說出明顯錯誤時不打斷、不糾正（錯誤由批改模組事後處理），但可以用正確說法自然複述一次（recast）
5. 對話達成目標或超過 8 輪時，回覆以 "[TASK_COMPLETE]" 結尾
```

### 6.3 批改回饋器（grader）

```
你是嚴謹的{語言}寫作批改老師，服務對象為 B1+ 程度的台灣學習者。

輸入：寫作題目、使用者作答、（可選）口說逐字稿。

只輸出 JSON，不加前言、不用圍欄：
{
  "minimal_fix": "最小修改版：只改錯誤，保留原句結構",
  "native_version": "母語自然版：母語者會怎麼寫",
  "errors": [{
    "original": "原錯誤片段",
    "corrected": "修正",
    "error_type": "文法類別（如：假設語氣/時態/冠詞/助詞/敬體/中式表達）",
    "rule_note": "30 秒內能讀完的規則說明（繁體中文）",
    "drill": [{"q": "變化練習選擇題", "options": ["A","B","C","D"], "answer": "A", "explain": ""}]
  }],
  "praise": "一句具體的優點（不空泛）"
}

批改原則：
1. 只列真正的錯誤，不吹毛求疵；風格差異放進 native_version 而非 errors
2. error_type 必須從固定分類表挑選（英文：時態/冠詞/單複數/介系詞/假設語氣/關係子句/分詞構句/倒裝/中式表達/用字；日文：助詞/動詞變化/自他動詞/授受表現/語體不一致/時制/用字）
   日文的「語體不一致」只抓用錯對象或同篇混用；整篇用普通体不是錯誤
3. 每個錯誤附 2-3 題 drill
```

### 6.4 週報生成器（weeklyReport）

```
你是學習教練。輸入為某成員最近 30 天的 errors 紀錄（含類別統計與改善狀態）。
輸出繁體中文 Markdown 週報，包含：
1. 三個最弱文法類別與具體例句對照（錯 → 對）
2. 「避坑指南」：用「你在...情況下，常常...」的句式描述 2-3 個行為模式
3. 已驗證改善的項目（給予肯定）
4. 下週建議輪替的文法點 2 個
禁止空泛鼓勵，每一條都要有數據或例句支撐。
```

## 7. 資料庫 Schema 摘要

完整 SQL 在 `supabase/schema.sql`（BUILD_STEPS 步驟 3 建立）。

- `profiles`：id, name, languages[], level, scenario_pool[]
- `tasks`：id, profile_id, language, task_json, status(pending/done), created_at, completed_at
- `errors`：id, profile_id, language, original, corrected, error_type, rule_note, status(active/pending_verify/resolved), verify_count, created_at, resolved_at（攻克時間，migration-011）
- `grammar_points`：id, language, name, level, description, in_rotation(bool)
- `taiwanese_scripts`：id, title, lines(jsonb: 台文漢字/台羅/華語對照), notes(jsonb), level, topic, audio_urls(jsonb), created_at
- `extensive_listens`：id, profile_id, language, title, script, topic, level, created_at（泛聽教材，migration-009）

錯誤狀態機：`active`（新錯誤）→ 連續 2 次「**有機會犯卻沒犯**」→ `pending_verify`（任務生成器刻意埋設情境）→ 驗證通過 → `resolved`。

「有機會犯」是關鍵限定：任務生成時會挑最舊的 3 筆 active 錯誤，要求生成器把情境設計成非用到該句型不可，並記在 `task_json.exposure_error_ids`。只有這些錯誤才會因為本次沒再犯而推進 `verify_count`。單純「這次沒犯」不算數——那很可能只是任務根本沒用到那個句型，據此推進會累積出假陽性的 `resolved`，學習者以為攻克了、系統也不再考他，錯誤就永久逃逸。

## 8. 程式規範

1. 全部 TypeScript，禁止 `any`（除第三方型別缺失處並註記）
2. UI 文案一律繁體中文；學習內容依目標語言呈現
3. 元件保持小而單一職責；頁面邏輯放 pages、共用邏輯放 lib
4. 所有 Claude API 呼叫必經 `lib/claude.ts`，禁止在元件內直接 fetch Worker
5. SpeechRecognition 需做瀏覽器相容偵測，不支援時顯示「請改用鍵盤輸入」降級方案
   （台語沒有 SpeechRecognition 可用，跟讀改比語調節奏，見 `lib/audioProsody.ts`）
6. 手機優先設計（主要使用裝置為手機/平板），觸控目標 ≥ 44px
7. 每完成一個步驟即 git commit，訊息格式：`step-N: 簡述`

## 9. 環境變數

| 位置 | 變數 | 說明 |
|---|---|---|
| Worker | `ANTHROPIC_API_KEY` | wrangler secret，絕不進 git |
| Worker | `YATING_API_KEY` | wrangler secret，台語語音；沒設只影響台語 |
| Worker | `GOOGLE_TTS_API_KEY` | wrangler secret，英日韓語音；沒設會自動退回瀏覽器內建語音，不會壞掉 |
| Worker | `ACCESS_PASSPHRASE` | wrangler secret，選配；沒設就是預設狀態（任何人拿到網址都能用），見 `ACCESS_GATE_MEMO.md` |
| Worker | `ALLOWED_ORIGIN` | GitHub Pages 網址，CORS 白名單 |
| 前端 `.env` | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase 連線 |
| 前端 `.env` | `VITE_WORKER_URL` | Worker 端點 |

`.env` 加入 `.gitignore`，提供 `.env.example`。

## 10. 禁止事項

- 不做登入/註冊/金流/多租戶
- 不引入付費語音 API，以下兩個是使用者明確同意的例外：
  - 台語雅婷（2026-07 同意）——已實作但預設關閉
  - 英日韓 Google Cloud TTS（2026-08 同意）——聽力與口說對話都用它，每月前 100 萬字元免費，
    家庭用量約 12 萬；一律 1.0 倍速合成（語速交給前端 `playbackRate`）以維持快取命中率
- 不引入付費語音「評測」API（Azure Pronunciation Assessment 等）——使用者於 2026-08 決定不做發音評分
  （選配的 `ACCESS_PASSPHRASE` 通關密碼不算：全家共用一組密碼，沒有帳號、
  沒有使用者資料、沒有後台審核，只是擋在 Worker 前面防網址外流，見 `ACCESS_GATE_MEMO.md`）
- 不引入付費語音 API（台語雅婷除外——使用者已於 2026-07 明確同意，已實作但預設關閉）
- 不在前端暴露任何 API key（Supabase anon key 除外，屬設計內公開）
- 不擅自升級/更換主要框架與模型字串
- 不生成與任務無關的大量教材塞進資料庫
