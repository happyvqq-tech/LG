# CLAUDE.md — 家庭語言學習 PWA（專案規則檔）

> 本檔案放在 repo 根目錄。Claude Code 執行任何指令前，先閱讀本檔全文並遵守所有規範。

---

## 1. 專案概述

自用家庭語言學習 Web App（PWA），不對外販售、不做商業功能。

- **語言範圍**：英文（聽說讀寫）、日文（聽說讀寫）、韓文（聽說讀寫）、古文（句讀／字詞／翻譯，獨立模組）、台語（只有聽、說；獨立模組，語音來自雅婷 TTS）
- **使用者**：2～4 位家庭成員，程度 B1+ 起跳（高中以上）
- **核心理念**：任務式循環（聽 → 讀 → 說 → 寫）＋ 個人錯誤記憶庫 ＋ 文法點驅動
- **無登入系統**：首頁選擇成員即可，不做帳號密碼、不做付費、不做多租戶

## 2. 技術棧（不可擅自更換）

| 層 | 技術 |
|---|---|
| 前端 | React 18 + Vite + TypeScript + Tailwind CSS |
| PWA | vite-plugin-pwa（可安裝、離線 shell） |
| 部署（前端） | GitHub Pages（gh-pages branch 或 Actions） |
| 後端 | Cloudflare Workers（唯一職責：藏 API key、轉發 Claude API、簡單限流） |
| 資料庫 | Supabase 免費版（PostgreSQL），前端用 anon key 直連 |
| AI | Anthropic Claude API（模型見第 5 節） |
| 語音 | 英日韓古文用瀏覽器內建：speechSynthesis（TTS）、SpeechRecognition（STT） |
| 台語語音 | 雅婷 TTS（`tts.api.yating.tw`），經 Worker `/api/tts` 代理，key 存 Worker secret |

## 3. 架構

```
瀏覽器 PWA (GitHub Pages)
   ├── Supabase JS client ──→ Supabase（profiles / tasks / errors / grammar_points）
   ├── fetch ──→ Cloudflare Worker /api/chat ──→ api.anthropic.com /v1/messages
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
│   └── wrangler.toml
├── src/
│   ├── pages/              # MemberSelect / TaskHome / Listening / Reading /
│   │                       # Speaking / Writing / Feedback / GrammarDrill / Taiwanese
│   ├── components/
│   ├── lib/
│   │   ├── claude.ts       # 呼叫 Worker 的統一封裝（含 JSON 解析與重試）
│   │   ├── supabase.ts
│   │   ├── speech.ts       # TTS/STT 封裝（瀏覽器 API）
│   │   └── prompts/        # 4 個 prompt 模組（見第 6 節，內容以本檔為準）
│   └── data/
│       └── grammar_points.ts  # 高中核心文法點種子清單
└── supabase/schema.sql
```

## 5. AI 模組與模型配置

| 模組 | 模型字串 | 用途 | 輸出 |
|---|---|---|---|
| 任務生成器 | `claude-haiku-4-5` | 生成每日任務（情境、聽力稿、語塊、口說目標、寫作題） | JSON |
| 對話角色 | `claude-haiku-4-5` | 口說練習的對手，多輪對話 | 純文字 |
| 批改回饋器 | `claude-sonnet-4-6` | 寫作批改、錯誤分類、文法微課、快練出題 | JSON |
| 週報生成器 | `claude-sonnet-4-6` | 讀錯誤庫，生成避坑指南 | Markdown |
| 台語腳本生成 | `claude-sonnet-4-6` | 生成台語腳本（漢字／台羅／華語三對照） | JSON |

- API 端點：`POST https://api.anthropic.com/v1/messages`，headers：`x-api-key`、`anthropic-version: 2023-06-01`、`content-type: application/json`
- 官方文件：https://docs.claude.com/en/api/overview
- **凡要求 JSON 輸出的模組**：system prompt 必須明確要求「只輸出 JSON，不加任何前言與 markdown 圍欄」；前端 `claude.ts` 仍需做圍欄剝除與 try-catch 解析，解析失敗自動重試一次
- max_tokens：對話 1024、任務生成 3000、批改 3000、週報 2000、台語腳本 3000

## 6. Prompt 模組（完整內容）

以下為四個模組的 system prompt 基準版本，實作放在 `src/lib/prompts/`，可微調但不得刪除核心要求。

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
3. 語塊（chunks）給 5-8 個，是可整段套用的片語，不是單字
4. 寫作題必須與情境直接相關，30-80 字即可完成
5. 日文任務需標註丁寧體/普通體要求

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
2. error_type 必須從固定分類表挑選（英文：時態/冠詞/單複數/介系詞/假設語氣/關係子句/分詞構句/倒裝/中式表達/用字；日文：助詞/動詞變化/敬體普通體/時制/用字）
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
- `errors`：id, profile_id, language, original, corrected, error_type, rule_note, status(active/pending_verify/resolved), verify_count, created_at
- `grammar_points`：id, language, name, level, description, in_rotation(bool)
- `taiwanese_scripts`：id, title, lines(jsonb: 台文漢字/台羅/華語對照), notes(jsonb), level, topic, audio_urls(jsonb), created_at

錯誤狀態機：`active`（新錯誤）→ 連續 2 次任務未再犯 → `pending_verify`（任務生成器刻意埋設情境）→ 驗證通過 → `resolved`。

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
| Worker | `ALLOWED_ORIGIN` | GitHub Pages 網址，CORS 白名單 |
| 前端 `.env` | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Supabase 連線 |
| 前端 `.env` | `VITE_WORKER_URL` | Worker 端點 |

`.env` 加入 `.gitignore`，提供 `.env.example`。

## 10. 禁止事項

- 不做登入/註冊/金流/多租戶
- 不引入付費語音 API（台語雅婷除外——使用者已於 2026-07 明確同意，已實作）
- 不在前端暴露任何 API key（Supabase anon key 除外，屬設計內公開）
- 不擅自升級/更換主要框架與模型字串
- 不生成與任務無關的大量教材塞進資料庫
