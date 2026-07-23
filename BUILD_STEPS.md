# BUILD_STEPS.md — 分步指令包（共 19 步，三階段）

> 使用方式：在 Claude Code 中逐步貼上每一步的「指令」區塊。每步完成後先檢查「驗收標準」，通過再進下一步。CLAUDE.md 必須先放在 repo 根目錄。

---

# 第一階段：英文核心循環（步驟 1–11）

## 步驟 1：專案初始化

**指令：**
```
閱讀 CLAUDE.md。建立 Vite + React + TypeScript 專案，安裝並設定 Tailwind CSS 與 vite-plugin-pwa。
建立 CLAUDE.md 第 4 節的目錄結構（空檔案/占位即可）。
設定 react-router（HashRouter，因為部署在 GitHub Pages）與 8 個頁面的空路由：
MemberSelect(/)、TaskHome、Listening、Reading、Speaking、Writing、Feedback、GrammarDrill。
建立 .env.example 與 .gitignore。npm run dev 需可啟動並在各路由間切換。
```

**驗收標準：** dev server 啟動、各空頁面可導航、Tailwind 樣式生效、PWA plugin 已註冊。

## 步驟 2：Cloudflare Worker 代理

**指令：**
```
在 worker/ 建立獨立 wrangler 專案。實作 POST /api/chat：
1. 檢查 Origin 是否等於 ALLOWED_ORIGIN（開發模式允許 localhost）
2. 接收 body：{ model, system, messages, max_tokens }
3. 轉發到 https://api.anthropic.com/v1/messages，headers 帶
   x-api-key（來自環境變數 ANTHROPIC_API_KEY）、anthropic-version: 2023-06-01
4. 回傳 Anthropic 原始 JSON；處理 CORS preflight
5. 簡單限流：同 IP 每分鐘 20 次（用 Workers 的 in-memory Map 即可，自用夠了）
提供 wrangler dev 本地測試方式與 curl 測試範例。
```

**驗收標準：** `wrangler dev` 下用 curl 呼叫可取得 Claude 回覆；未帶正確 Origin 被拒。

## 步驟 3：Supabase Schema

**指令：**
```
依 CLAUDE.md 第 7 節撰寫 supabase/schema.sql，含五張表的完整 CREATE TABLE（欄位型別、預設值、
created_at 預設 now()、必要索引：errors(profile_id, status)、tasks(profile_id, created_at)）。
RLS：自用專案，開啟 RLS 但建立 anon 可讀寫全部的 policy（家庭內部使用，不做隔離）。
另寫 seed.sql：插入 2 個示範成員 profile（成員A：英文+日文 B2；成員B：英文 B1+），
以及 grammar_points 種子資料——由你（Claude Code）產生英文高中核心文法點 60 個
（含 name、level A2-C1、description 繁中一句話），日文文法點 30 個（N4-N2 範圍）。
我會自行在 Supabase SQL Editor 執行。同時完成 src/lib/supabase.ts 連線封裝。
```

**驗收標準：** 兩份 SQL 在 Supabase 執行無錯誤；前端可讀出 profiles。

## 步驟 4：成員選擇頁 + 程度設定

**指令：**
```
實作 MemberSelect 頁：讀取 profiles 顯示成員卡片（大按鈕、適合手機），點選後把
profile 存入 React context + localStorage（記住上次選擇），導向 TaskHome。
加一個簡單的「編輯成員」抽屜：可改名稱、語言（多選：英文/日文/台語）、程度、情境池
（checkbox 清單：校園/日常/旅遊/職場/新聞時事/科技，可複選）。
```

**驗收標準：** 選擇成員後重新整理仍記得；編輯可寫回 Supabase。

## 步驟 5：claude.ts 封裝 + 任務生成器

**指令：**
```
1. 實作 src/lib/claude.ts：callClaude({module, system, messages, maxTokens})，
   module→model 對照依 CLAUDE.md 第 5 節；含 JSON 圍欄剝除、try-catch 解析、失敗重試一次、
   統一錯誤型別。
2. 實作 src/lib/prompts/taskGenerator.ts，內容完全依 CLAUDE.md 6.1，變數用模板函式注入。
3. TaskHome 頁：顯示「今日任務」卡。若今日無 pending task，按「生成任務」→
   從 grammar_points 取 in_rotation 的 1-2 個 + errors 取 pending_verify ≤3 筆 →
   呼叫任務生成器 → 存入 tasks 表 → 顯示 scenario_title/desc 與「開始」按鈕。
   任務生成中要有 loading 狀態與失敗重試按鈕。
```

**驗收標準：** 可生成任務並落庫；重新整理後今日任務仍在；JSON 解析穩定。

## 步驟 6：聽力頁（TTS）

**指令：**
```
實作 src/lib/speech.ts 的 TTS 部分：封裝 speechSynthesis，函式 speak(text, lang, rate)，
lang 對照 en-US / ja-JP；列出可用 voices 並優先挑選自然度較高者（Edge 線上聲音優先），
提供語速 0.75x / 1x 切換與「分句播放」（依句號切分逐句播）。
Listening 頁：播放 listening_script 但【不顯示文字】，只有播放/暫停/重播/分句/語速控制，
聽 2 次後出現「我聽完了 → 進入閱讀」按鈕。
```

**驗收標準：** 手機 Chrome/Edge 可正常發音；語速與分句功能可用；文字不外洩於畫面。

## 步驟 7：閱讀與語塊頁

**指令：**
```
Reading 頁：顯示 listening_script 全文；chunks 以卡片呈現（text / zh / usage），
點語塊卡可用 TTS 唸該語塊。全文中出現語塊處以底色標記。
底部按鈕「進入口說」。
```

**驗收標準：** 語塊標記正確、點卡發音正常。

## 步驟 8：口說對話頁（STT + 對話角色）

**指令：**
```
1. speech.ts 加入 STT：封裝 SpeechRecognition（webkitSpeechRecognition fallback），
   按住說話/放開結束，回傳逐字稿；不支援的瀏覽器顯示鍵盤輸入框降級。
2. 實作 prompts/dialogPartner.ts（依 CLAUDE.md 6.2）。
3. Speaking 頁：聊天室 UI。開場由 AI 依 speaking_role_setup 先說第一句（並 TTS 唸出）。
   使用者按住麥克風說話 → 逐字稿上屏 → 送對話角色 → 回覆上屏並 TTS 唸出。
   「卡關求助」按鈕送出 HINT_REQUEST。偵測到 [TASK_COMPLETE] 顯示完成動畫並解鎖「進入寫作」。
   對話全程逐字稿存入該 task 的 task_json.speaking_transcript。
```

**驗收標準：** 完整多輪語音對話可跑通；求助提示運作；transcript 有落庫。

## 步驟 9：寫作與批改頁

**指令：**
```
1. 實作 prompts/grader.ts（依 CLAUDE.md 6.3）。
2. Writing 頁：顯示 writing_prompt，textarea 作答（顯示字數），提交後呼叫批改回饋器，
   同時把 speaking_transcript 一併送入供參考。
3. 批改結果頁面（同頁下方展開）：
   - 並排顯示 minimal_fix 與 native_version（差異處高亮）
   - errors 逐項卡片：original→corrected、error_type 標籤、rule_note
   - 每項錯誤附「30 秒微課」按鈕 → 彈窗顯示 rule_note + drill 選擇題，即答即對
```

**驗收標準：** 批改 JSON 穩定渲染；微課答題流程順暢。

## 步驟 10：錯誤記憶庫 + 回饋頁

**指令：**
```
1. 批改完成後，將 errors 陣列逐筆寫入 errors 表（status='active'）。
2. Feedback 頁（任務結尾）：本次總結——新語塊清單、犯錯清單、praise；
   按「完成任務」→ tasks.status='done'、completed_at 寫入 → 回 TaskHome。
3. 錯誤狀態機邏輯（lib/errorEngine.ts）：
   - 任務完成時，比對本次 errors 與既有 active 錯誤（同 error_type + 相似 original），
     未再犯者 verify_count +1；verify_count ≥2 → status='pending_verify'
   - pending_verify 的錯誤會被步驟 5 的任務生成器取用埋設情境；
     埋設後的任務中若未再犯 → status='resolved'，若再犯 → 退回 active、verify_count 歸零
4. TaskHome 加一個「錯誤庫」入口：依 error_type 分組列表，顯示狀態徽章
   （學習中/驗證中/已攻克），已攻克區給成就感樣式。
```

**驗收標準：** 完整任務循環後 errors 正確落庫；狀態機在連續任務中轉移正確。

## 步驟 11：PWA 完善 + 部署

**指令：**
```
1. 完成 PWA manifest（名稱、icon 用簡單生成的字母圖示、theme color）、
   service worker 快取 app shell。
2. 設定 GitHub Actions：push main → build → 部署 GitHub Pages；
   注意 Vite base 路徑設為 repo 名稱。
3. worker/ 部署說明：wrangler secret put ANTHROPIC_API_KEY、
   wrangler deploy、設定 ALLOWED_ORIGIN 為 Pages 網址。
4. 產出 DEPLOY.md：從零到上線的完整檢查清單（含 Supabase 設定值要填哪裡）。
```

**驗收標準：** 手機可「加入主畫面」安裝；線上網址完整跑通一個英文任務循環。

---

# 第二階段：文法系統 + 日文（步驟 12–16）

## 步驟 12：文法輪替管理

**指令：**
```
TaskHome 加「本週文法點」設定區：從 grammar_points 勾選 in_rotation（上限 4 個），
支援搜尋與依 level 篩選。任務生成器改為從 in_rotation 中隨機取 1-2 個。
另加「段考模式」開關：開啟時輪替池只從使用者勾選的文法點取，並在任務卡上顯示目標文法點。
```

**驗收標準：** 輪替設定影響後續生成的任務；grammar_points_used 有記錄回 task_json。

## 步驟 13：文法快練頁

**指令：**
```
GrammarDrill 頁：
1. 選擇模式：(a) 指定文法點 (b) 自動挑錯誤庫中 active 數量最多的文法類別
2. 呼叫批改回饋器模型（sonnet）以出題 prompt 生成 10 題選擇題
   （仿台灣高中段考/學測題型：文法選擇 6 題 + 克漏字一小段 4 格），JSON 格式
3. 即答即對、逐題解析、結束顯示分數；答錯的題目其文法點寫入 errors（error_type 對應）
4. 加「貼上範圍」輸入框：使用者貼課文段落或範圍描述 → 出題時作為素材依據
出題 prompt 寫在 prompts/drillGenerator.ts，要求只輸出 JSON。
```

**驗收標準：** 10 題流程完整；貼上課文後題目明顯貼合素材。

## 步驟 14：日文支援

**指令：**
```
1. 全流程支援 language='日文'：任務生成器帶入日文規則（丁寧體/普通體標註）、
   TTS 用 ja-JP、STT 用 ja-JP、批改分類表切換為日文版（助詞/動詞變化/敬體普通體/時制/用字）
2. Reading 頁日文模式：語塊卡增加假名讀音欄位（任務生成器 JSON 的 chunks 加 furigana 欄）
3. 驗證成員A（英+日）可在 TaskHome 切換語言分別生成任務
```

**驗收標準：** 日文任務完整循環可跑通，批改分類正確使用日文類別。

## 步驟 15：週報 / 避坑指南

**指令：**
```
1. 實作 prompts/weeklyReport.ts（依 CLAUDE.md 6.4）。
2. TaskHome 加「學習報告」入口：統計卡（近 30 天任務數、錯誤數、已攻克數、
   錯誤類別長條圖——用簡單 CSS bar 即可不引入圖表庫）＋「生成本週避坑指南」按鈕，
   呼叫週報生成器，結果以 Markdown 渲染並存 localStorage 快取（每週最多生成一次）。
```

**驗收標準：** 報告數據正確；避坑指南內容引用了真實錯誤紀錄。

## 步驟 16：明天就要用模式

**指令：**
```
TaskHome 加「急救包」入口：輸入近期目標（如「後天英文口試自我介紹」）→
任務生成器變體 prompt 生成 3 個連續小任務（重點句型清單 → 模擬問答口說 → 一篇短寫作），
以特殊標記存入 tasks（task_json.type='emergency'），可連續完成。
```

**驗收標準：** 輸入目標後生成的三任務高度貼合目標情境。

---

# 第三階段：台語模組（步驟 17–19）

## 步驟 17：台語腳本生成與管理

**指令：**
```
1. Taiwanese 頁 + 路由。腳本生成：輸入場景（吃飯/出門/買東西/阿公阿嬤講電話…）→
   呼叫 sonnet 生成 6-10 句家庭日常對話，每句含：台文漢字、台羅拼音、華語對照，
   JSON 存入 taiwanese_scripts。
2. 腳本列表頁 + 腳本檢視頁（三行對照排版，台文字級最大）。
3. 提供「編輯句子」功能——生成內容需人工校對，可逐句修改後儲存。
```

**驗收標準：** 生成、校對、儲存流程完整；台羅拼音欄位正確顯示。

## 步驟 18：跟讀練習（AB 對照）

**指令：**
```
1. 音檔管理：每句可上傳一個示範音檔（家長用雅婷台語 TTS 網頁版手動產生下載，
   或自己錄音），存 Supabase Storage，URL 寫入 taiwanese_scripts.audio_urls。
2. 跟讀模式（逐句）：播放示範 → 按住錄音（MediaRecorder API）→ 放開後自動
   「示範→自己的錄音」連續播放（AB 對照）→ 按「再一次」或「下一句」。
   自己的錄音只存在記憶體，不上傳。
3. 提詞機模式：全螢幕大字逐句顯示（台文為主、台羅為輔可開關），左右滑動換句，
   供家庭角色扮演時當提詞用。
```

**驗收標準：** 手機上錄音與 AB 對照播放順暢；提詞機模式在手機橫放時可讀性佳。

## 步驟 19：收尾優化

**指令：**
```
1. 全站體檢：手機實機測試三語言全流程，修正版面與觸控問題
2. 錯誤處理總檢查：API 失敗、離線、麥克風權限拒絕，皆有清楚的中文提示
3. 效能：任務 JSON 與腳本列表加 localStorage 快取，減少 Supabase 讀取
4. 產出 USER_GUIDE.md：給家庭成員看的一頁使用說明（含 iOS/Android 安裝到主畫面步驟）
```

**驗收標準：** 三語言在手機實機完整可用；家人不需你解說即可依 USER_GUIDE 上手。

---

## 附註

- 每步驟 commit 一次（`step-N: 簡述`），出問題可回滾
- 步驟 3 的 SQL 需你手動到 Supabase SQL Editor 執行，其餘皆 Claude Code 完成
- 若某步驟 Claude Code 的產出偏離 CLAUDE.md 規範，直接回覆：「重新閱讀 CLAUDE.md 第 X 節後修正」
- 台語雅婷 TTS 若日後想改為 API 自動化（免去手動產音檔），屆時再加一個步驟 20，需另註冊雅婷開發者帳號
