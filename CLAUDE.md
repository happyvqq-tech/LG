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
| 歌詞 | LRCLIB（`lrclib.net`，免費免金鑰，回傳逐句時間戳的 LRC），經 Worker `/api/lyrics` 代理並快取；查不到時退回請使用者自己貼 |
| 原曲／影片 | YouTube 官方嵌入（不代管任何影音檔）。影片以 YouTube Data API v3 搜尋，經 Worker `/api/youtube`；沒設金鑰時改請使用者貼一次連結 |
| 文章推薦 | 各語言幾家新聞的 RSS，經 Worker `/api/feeds` 合併並快取 30 分鐘（清單在 `worker/src/index.ts` 的 `FEEDS`，某家失效改那裡再 deploy 就好）。AI 只從這份真實清單裡**用索引挑**，不憑記憶推薦 |
| 文章 | 使用者貼網址或全文。網址經 Worker `/api/article` 抓一次並抽出本文（純函式在 `worker/src/articleExtract.ts`），抓不到就請使用者貼；AI 只分析不重打原文 |
| 影片逐字稿 | 三層：Worker `/api/transcript` 盡力試抓 → 書籤小工具（在 YouTube 頁面上讀已渲染的轉錄稿面板，100% 可靠）→ 使用者手動貼上。沒有可靠的免費自動來源，理由見 `worker/src/index.ts` 的 `handleTranscript` |

## 3. 架構

```
瀏覽器 PWA (GitHub Pages)
   ├── Supabase JS client ──→ Supabase（profiles / tasks / errors / grammar_points）
   ├── fetch ──→ Cloudflare Worker /api/chat ──→ api.anthropic.com /v1/messages
   ├── fetch ──→ Cloudflare Worker /api/gtts ──→ texttospeech.googleapis.com（英日韓語音，含快取）
   ├── fetch ──→ Cloudflare Worker /api/tts  ──→ tts.api.yating.tw（台語語音，含快取）
   ├── fetch ──→ Cloudflare Worker /api/lyrics ──→ lrclib.net（歌詞＋逐句時間戳，含快取）
   ├── fetch ──→ Cloudflare Worker /api/youtube ──→ YouTube Data API（找原曲與學習影片，含快取）
   ├── fetch ──→ Cloudflare Worker /api/transcript ──→ youtube.com（盡力試抓字幕，常失敗，含快取）
   ├── fetch ──→ Cloudflare Worker /api/article ──→ 任意公開網頁（抽出本文，含快取與內網防護）
   └── fetch ──→ Cloudflare Worker /api/feeds ──→ 各家新聞 RSS（今天的標題清單，含快取）
                     （API key 存在 Worker 環境變數，絕不出現在前端程式碼）
```

## 4. 目錄結構

```
/
├── CLAUDE.md
├── BUILD_STEPS.md          # 分步指令包
├── worker/                 # Cloudflare Worker（獨立 wrangler 專案）
│   ├── src/index.ts
│   ├── src/youtubeCaptions.ts  # YouTube 字幕解析（純函式，網路那段在 index.ts）
│   ├── src/articleExtract.ts   # 網頁 HTML 抽出本文（純函式，同上）
│   ├── src/rss.ts              # RSS／Atom 解析與多來源輪流合併（純函式）
│   ├── src/prompts/        # 全部 15 個 system prompt 與模型選擇（見第 6 節）
│   └── wrangler.toml
├── src/
│   ├── pages/              # MemberSelect / TaskHome / Listening / Reading /
│   │                       # Speaking / Writing / Rewrite / Feedback / GrammarDrill / Taiwanese
│   │                       # TaskArchive / TaskReview（教材庫：所有生成過的教材——任務與歌曲——都在這裡翻閱）
│   │                       # BackTranslate（回譯：看中文產出目標語，再跟原句比對）
│   │                       # Fluency（流利度 4/3/2：同段話講三次，時間遞減）
│   │                       # ExtensiveHome / ExtensivePlayer（泛聽：長而簡單，只聽不練）
│   │                       # Progress（進步存摺：累積量、本期vs上期、成長曲線、練習足跡、里程碑）
│   │                       # QuickSession（五分鐘模式：到期單字＋舊錯＋重聽，做完算連續天數）
│   │                       # SongHome / SongStudy（歌曲：AI 選歌、使用者貼歌詞、逐行標可用性）
   │                       # VideoHome / VideoStudy（影片：AI 給搜尋方向、使用者貼逐字稿、逐句播原聲）
   │                       # ArticleHome / ArticleStudy（文章：真實文本、長句解剖、書面轉口語）
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
│   │   ├── quickRules.ts   # 五分鐘模式的排卡與時間預算（純函式）
│   │   ├── levelAdviceRules.ts # 難度升降建議：只建議不自動改（純函式）
│   │   ├── scenarioPool.ts # 情境挑選，含 15% 的「意料之外」情境（純函式）
│   │   ├── songService.ts  # 歌曲教材：推薦歌單、自動抓歌詞、找原曲、分段進度
│   │   ├── lrc.ts          # 同步歌詞解析與逐行對位（純函式），分段播放靠它
│   │   ├── videoService.ts # 影片教材：搜尋方向、把方向變成真實影片、做成教材
│   │   ├── transcript.ts   # YouTube 逐字稿解析與逐句對時（純函式），逐句播放靠它
│   │   ├── articleService.ts # 文章教材：依網址抓本文、做成教材
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
| 歌曲推薦 | `claude-sonnet-4-6` | 挑歌並分別評「知名度」與「學習適用度」；**禁止輸出歌詞** | JSON |
| 歌曲教材 | `claude-sonnet-4-6` | 把使用者貼上的歌詞分段，逐行標「能不能拿去用」 | JSON |
| 影片方向 | `claude-sonnet-4-6` | 依程度與主題給 YouTube **搜尋方向**；**禁止推薦具體影片** | JSON |
| 影片教材 | `claude-sonnet-4-6` | 從逐字稿挑 8-15 行精聽，標連音脫落、填充詞、腔調 | JSON |
| 文章推薦 | `claude-sonnet-4-6` | 從今天的 RSS 清單裡挑 3-5 篇並評難度；**只能用索引回答，不可推薦清單外的文章** | JSON |
| 文章教材 | `claude-sonnet-4-6` | 真實文章的長句解剖、指涉鏈、書面轉口語；**禁止重打或改寫原文** | JSON |

- API 端點：`POST https://api.anthropic.com/v1/messages`，headers：`x-api-key`、`anthropic-version: 2023-06-01`、`content-type: application/json`
- 官方文件：https://docs.claude.com/en/api/overview
- **凡要求 JSON 輸出的模組**：system prompt 必須明確要求「只輸出 JSON，不加任何前言與 markdown 圍欄」；前端 `claude.ts` 仍需做圍欄剝除與 try-catch 解析，解析失敗自動重試一次
- max_tokens：對話 1024、任務生成 3000、批改 3000、週報 2000、台語腳本 3000、歌曲推薦 2000、歌曲教材 4000（逐行四個欄位，上限要給得寬）、影片方向 2000、影片教材 2500、文章推薦 2000、文章教材 3000（長句解剖要把原句整句抄回來）
- **影片不讓模型推薦具體某一支**：模型記不住哪支 YouTube 影片存在、標題叫什麼、在哪個頻道。
  推薦一支不存在的影片比不推薦更糟——使用者搜不到就會不信任整個功能。所以 videoPicker 只給
  搜尋方向（它真正可靠的事），真實影片交給 YouTube Data API；沒設金鑰時就給一個搜尋連結，
  讓使用者自己挑（其實更好，他看得到縮圖與長度）
- **影片教材跟歌曲教材的重心不同**：歌曲逐行標「能不能拿去用」（旋律會為了押韻與音節數扭曲語言）；
  影片是真實口語，本來就能用，要回答的是**為什麼你聽不懂**——連音與脫落（what do you→whaddaya、
  〜ている→〜てる）、填充詞（you know／なんか，知道可以當雜訊跳過本身就是聽力技能）、腔調規則。
  照抄歌曲的設計會做出一份沒搔到癢處的教材
- **文章可以 AI 推薦、影片只能給搜尋方向，差別在有沒有「今天的清單」**：
  模型記不住哪篇文章或哪支影片存在。新聞有 RSS，所以 Worker 先把今天真的存在的標題抓回來，
  模型只從清單裡**用索引挑**；前端驗證時索引超出範圍、重複、非整數的一律丟掉——
  結構上就不可能推薦出不存在的文章。畫面上的標題與網址都來自 RSS，不是模型寫的。
  YouTube 沒有這種清單可以先給它看，所以影片那邊退一步只給搜尋字串
- **三個真實素材模組各自回答不同的問題，不可以互相照抄**：
  歌曲＝這句能不能拿去用（旋律會為了押韻扭曲語言）；影片＝為什麼你聽不懂（連音、脫落、
  填充詞）；文章＝**為什麼你讀不動**（長句解剖、指涉鏈、書面轉口語）。
  文章那一支刻意**不做逐句翻譯**：給了對照譯文，學習者的眼睛會直接吃中文，原文等於沒讀
- **文章的原文與送進 prompt 的必須是同一份**（都截到 `ARTICLE_MAX_CHARS`）。
  學習者會對照原文讀教材，分析只涵蓋前三分之一而畫面顯示全文的話，
  他會一直找不到教材在講哪一句
- **逐字稿跟歌詞一樣絕不讓模型生成**，理由相同（見下）。自動辨識的稿子有錯字是真實情況，
  prompt 明令照抄、不准「修正」
- **逐字稿沒有可靠的免費自動來源，這是已經查證過的結論，不要再換個套件重試一次**：
  官方 `captions.download` 只有影片擁有者能呼叫；非官方的 `timedtext` 卡 PO token
  （字幕網址帶 `exp=xpe` 就只回空內容，token 要 BotGuard 挑戰才算得出來）與機房 IP 封鎖
  （Cloudflare／AWS／GCP 的 IP 收到「Sign in to confirm you're not a bot」）；
  前端直接抓則被 CORS 擋死（youtube.com 不回 `Access-Control-Allow-Origin`）。
  社群的解法是住宅代理，那要錢。所以 `/api/transcript` 定位是「失敗成本為零的試抓」，
  真正可靠的自動化是書籤小工具——它在 YouTube 頁面上跑，讀的是播放器**已經渲染好**的
  轉錄稿面板，簽章那關播放器早就過了
- **教材長度一律分語言寫明單位**：「250 字」在英文是詞、在日韓是字元，差了快三倍。
  同一個數字配同一套塞入要求（文法點、單字、錯誤句型），在日文會變成每一句都在扛任務、
  句與句之間沒有空間做銜接——「每句都對、連起來很怪」多半是這樣來的，不是模型不夠好
- **歌詞絕不讓模型生成**：模型憑記憶背的歌詞會錯字漏行，而教錯的歌詞比不教更糟——學習者跟著原曲唱會對不上，又分不出是自己聽錯還是教材錯。歌詞一律來自 LRCLIB（自動）或使用者貼上（退路），且生成教材前一定要讓使用者看過——歌詞庫偶爾會對到 Live 版或翻唱版
- **唱歌會破壞語調，所以「說的版本」是矯正器不是附屬品**：日文靠音高辨義（雨 HL ／ 飴 LH）而唱歌時音高由旋律決定，英文的重音會被節拍帶跑。songLesson 的 `prosody` 欄位就是在標這些地方，跟著唱會把錯的一起練進去且定型後極難改

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
1. 聽力稿長度**分語言寫明**（英文 180-260 詞／日文 400-600 字元／韓文 350-500 字元），
   口語自然，全部文法點**合計**出現 3-4 次（不是每個各三次）
1-1. 聽力稿必須是單一敘事者的連貫散文，**不可以是對白腳本**（不要有「店員：」這種說話人標記）；
   依情境選敘事型（定錨→轉折→處理→收束）或說明型（具體場面→為什麼值得一提→例子→影響）骨架
1-2. 語塊必須真的逐字出現在聽力稿裡（閱讀關卡會把它們標在文章上，標不到等於清單跟文章無關）
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

- `profiles`：id, name, languages[], level, scenario_pool[], interests（興趣與近況，migration-012）
- `tasks`：id, profile_id, language, task_json, status(pending/done), created_at, completed_at
- `errors`：id, profile_id, language, original, corrected, error_type, rule_note, status(active/pending_verify/resolved), verify_count, created_at, resolved_at（攻克時間，migration-011）
- `grammar_points`：id, language, name, level, description, in_rotation(bool)
- `taiwanese_scripts`：id, title, lines(jsonb: 台文漢字/台羅/華語對照), notes(jsonb), level, topic, audio_urls(jsonb), created_at
- `extensive_listens`：id, profile_id, language, title, script, topic, level, created_at（泛聽教材，migration-009）
- `songs`：id, profile_id, language, title, artist, lyrics, lesson(jsonb), segment_index, created_at（歌曲教材，migration-013）；synced（LRC 同步歌詞）, youtube_id（原曲影片 ID）為 migration-014
- `videos`：id, profile_id, language, title, youtube_id, transcript, lesson(jsonb), created_at（影片教材，migration-015）
- `articles`：id, profile_id, language, title, source_url, body, lesson(jsonb), created_at（文章教材，migration-016）

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
| Worker | `YOUTUBE_API_KEY` | wrangler secret，**選配**；歌曲模組用來找原曲，影片模組用來把搜尋方向變成真實影片。沒設只是要自己貼一次 YouTube 連結。可沿用 GCP 上那把 Google 金鑰，只要在金鑰的 API 限制裡多勾 YouTube Data API v3 |
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
