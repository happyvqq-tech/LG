# DEPLOY.md — 從零到上線完整檢查清單

照順序做，每一節做完再進下一節。全部完成後，手機開啟 Pages 網址即可安裝使用。

---

## 1. Supabase（資料庫）

1. 到 <https://supabase.com> 建立免費專案（區域選 Tokyo/Singapore 較快）
2. 進入 **SQL Editor**：
   - 貼上 `supabase/schema.sql` 全文 → Run（應顯示 Success）
   - 貼上 `supabase/seed.sql` 全文 → Run（寫入 2 位示範成員與 90 個文法點）
   - 貼上 `supabase/migration-002.sql` 全文 → Run（成員照片、每日學習計畫欄位）
   - 貼上 `supabase/migration-003.sql` 全文 → Run（單字庫 vocab_cards 表）
   - 貼上 `supabase/migration-004.sql` 全文 → Run（每日測驗成績 vocab_quizzes 表）
   - 貼上 `supabase/migration-005.sql` 全文 → Run（古文進度 classical_progress 表）
   - 貼上 `supabase/migration-006.sql` 全文 → Run（連續天數 activity_log、虛詞專練 particle_cards 表）
   - 貼上 `supabase/migration-007.sql` 全文 → Run（韓文文法點種子；沒跑的話韓文任務生成會失敗）
   - 貼上 `supabase/migration-008.sql` 全文 → Run（台語腳本欄位 notes / level / topic；沒跑的話台語腳本存不進去）
   - 貼上 `supabase/migration-009.sql` 全文 → Run（泛聽教材 extensive_listens 表；沒跑的話泛聽頁會提示你來跑）
     ⚠️ 已建過資料庫的人這幾段也要跑，否則會出現「column / table does not exist」
   - **`supabase/migration-010.sql` 先不要跑**——它會把資料庫從「任何人都能存取」
     改成「要帶通關密碼才行」，必須在第 2 節設好 `ACCESS_PASSPHRASE` 並在網站上
     輸入過一次密碼之後才跑。順序做錯會把自己鎖在外面（該檔開頭有完整說明與還原方式）

> 古文原文（《古文觀止》222 篇）不進資料庫，隨程式動態載入，第一次進古文頁才下載約 190KB，
> 之後由 Service Worker 快取，離線可讀。
3. 到 **Project Settings → API** 抄下兩個值：
   - `Project URL`（形如 `https://xxxx.supabase.co`）→ 之後填 `VITE_SUPABASE_URL`
   - `anon public` key → 之後填 `VITE_SUPABASE_ANON_KEY`
   （anon key 屬設計內公開，可放前端；service_role key 絕不能用）

## 2. Cloudflare Worker（Claude API ＋ 台語語音代理）

1. 到 <https://dash.cloudflare.com> 註冊/登入（免費方案即可）
2. 本機執行：

   ```bash
   cd worker
   npm install
   npx wrangler login                        # 開瀏覽器授權
   npx wrangler secret put ANTHROPIC_API_KEY  # 貼上 Anthropic API key（sk-ant- 開頭）
   npx wrangler secret put GOOGLE_TTS_API_KEY # 英日韓語音用，見下方第 7 點
   npx wrangler secret put YATING_API_KEY     # 台語語音用，見下方第 6 點
   ```

3. 編輯 `worker/wrangler.toml` 的 `ALLOWED_ORIGIN`：
   改成你的 GitHub Pages 網域，例如 `https://happyvqq-tech.github.io`（結尾不加斜線、不含 repo 路徑）
4. 部署並抄下網址：

   ```bash
   npx wrangler deploy
   # 輸出形如 https://lglearning-worker.<帳號>.workers.dev → 之後填 VITE_WORKER_URL
   ```

5. Anthropic API key 申請處：<https://console.anthropic.com>（Settings → API Keys）
6. 台語語音（雅婷 TTS）key 申請處：<https://developer.yating.tw>
   - 註冊後在 Dev Console 建立一把 API key
   - 新會員有等值 NT$1,000 的試用點數
   - 只有台語用得到；沒設的話英日韓照常運作，只有台語模組會顯示
     「台語語音服務暫時無法使用」
   - 設好之後打開 `https://<你的worker網址>/health` 應該看到
     `"yating_key": "已設定（xx 字元）"`
7. 英日韓語音（Google Cloud TTS）key 申請處：<https://console.cloud.google.com>
   - 建立專案 → **API 和服務 → 程式庫** → 搜尋 `Cloud Text-to-Speech API` → 啟用
   - **憑證 → 建立憑證 → API 金鑰**，建好後點「編輯 API 金鑰」→ **API 限制**
     選「限制金鑰」→ 只勾 Cloud Text-to-Speech API（這把 key 只存在 Worker，
     不會出現在前端，但還是要限制住）
   - 需要在專案上啟用帳單才能呼叫，但**每月前 100 萬字元免費**，
     四人家庭每天一個任務約 12 萬字元/月。建議到「帳單 → 預算與快訊」設一個預算警示
   - 沒設也不會壞：前端連續失敗三次後就整個 session 改用瀏覽器內建語音
   - 設好之後打開 `https://<你的worker網址>/health` 應該看到
     `"google_tts_key": "已設定（xx 字元）"`
8. 通關密碼（防網址外流被盜用 API 額度）：

   ```bash
   npx wrangler secret put ACCESS_PASSPHRASE   # 自訂一組全家共用的密碼
   ```

   - 這**不是帳號系統**，全家共用同一組密碼，只是擋在 `/api/chat`、`/api/tts`
     前面，避免陌生人拿到網址後亂用把 Anthropic／雅婷的額度燒光
   - 設定後前端第一次開站會跳出輸入畫面，輸對一次後存在該裝置的
     localStorage，之後不用每次都輸入；換裝置、換瀏覽器要再輸入一次
   - 完全不設就是原本的行為——任何人拿到網址都能直接用，這是預設狀態
   - 想換密碼：重新 `wrangler secret put ACCESS_PASSPHRASE` 蓋掉舊的，
     所有裝置下次呼叫 AI 功能時會自動被登出、跳回輸入畫面
     （若已跑過 `migration-010`，資料庫那組也要同步改，見該檔的「換密碼」段）
9. **設好密碼後**，回到第 1 節跑 `supabase/migration-010.sql`：
   - 這一步把資料庫也擋起來。在此之前，任何人只要從前端 JS 撈出 anon key，
     就能直接讀寫甚至刪光全家的學習資料——CORS 和通關密碼都擋不住那條路
   - 密碼要跟第 8 點設的**完全一樣**
   - 順序很重要：先部署前端 → 設 Worker secret → 在網站輸入過一次密碼 → 才跑 SQL

> 語音每合成一句就花一次額度，所以兩支 TTS 端點都用 Cloudflare Cache 快取。
> 台語依「句子＋音色＋語速」，Google 依「句子＋音色」——Google 一律用 1.0 倍速
> 合成、語速交給前端 `playbackRate`，所以 5 檔語速共用同一份音檔。
> 同一句重聽或別台裝置再聽都不會再收費。

## 3. GitHub Pages（前端）

1. 到 repo 的 **Settings → Pages**：Source 選 **GitHub Actions**
2. 到 **Settings → Secrets and variables → Actions → Variables** 新增三個 Repository variables：

   | 名稱 | 值 |
   |---|---|
   | `VITE_SUPABASE_URL` | 第 1 節抄的 Project URL |
   | `VITE_SUPABASE_ANON_KEY` | 第 1 節抄的 anon key |
   | `VITE_WORKER_URL` | 第 2 節抄的 Worker 網址 |

3. 把程式合併/推到 `main` branch → Actions 會自動 build 並部署
   （也可到 Actions 頁手動 Run workflow）
4. 完成後網址為 `https://<帳號>.github.io/<repo名>/`，目前是
   <https://happyvqq-tech.github.io/LG/>

> **repo 改名的話一定要同步改三個地方**，否則頁面會整個空白（而 Actions 仍顯示部署成功）：
> `vite.config.ts` 的 `base`、本節的網址、`src/lib/ics.ts` 行事曆提醒裡的連結。

## 4. 手機安裝（PWA）

- **Android Chrome**：開啟網址 → 右上角選單 → 「加到主畫面」/「安裝應用程式」
- **iOS Safari**：開啟網址 → 分享按鈕 → 「加入主畫面」

## 5. 本機開發（可選）

```bash
# 前端
cp .env.example .env   # 填入三個變數（VITE_WORKER_URL 用 http://localhost:8787）
npm install
npm run dev            # http://localhost:5173

# Worker（另開終端機）
cd worker
printf 'ANTHROPIC_API_KEY=sk-ant-你的key\nGOOGLE_TTS_API_KEY=你的google key\nYATING_API_KEY=你的雅婷key\nACCESS_PASSPHRASE=test1234\n' > .dev.vars
npx wrangler dev       # http://localhost:8787（自動允許 localhost Origin）
```

## 6. 上線驗收清單

- [ ] 首頁能看到成員A/成員B 卡片（Supabase 連線 OK）
- [ ] 點成員 → 生成任務成功（Worker + Claude API OK）
- [ ] 聽力頁能發音（TTS OK）
- [ ] 聽力頁「🗣️ 換發音」看得到「☁️ 雲端語音」那一區，試聽起來像真人（Google TTS OK）
- [ ] 口說對話頁 AI 回話用的也是雲端語音
- [ ] 口說頁按住能辨識（STT OK；不支援的瀏覽器顯示鍵盤輸入）
- [ ] 寫作提交能拿到批改結果，錯誤出現在「錯誤庫」
- [ ] 完成任務回到首頁，隔天可再生成新任務
- [ ] 台語首頁「試聽」有聲音（雅婷 TTS OK）
- [ ] 台語生成腳本成功、逐句能播、跟讀能錄音並拿到分數
- [ ] 手機可「加入主畫面」，開啟後為全螢幕 App 樣式
- [ ] （若設了 `ACCESS_PASSPHRASE`）開站會先跳出密碼畫面，輸對才進得去；
      輸錯會顯示「通關密碼不對」；輸對後重新整理不會再問第二次

## 常見問題

| 症狀 | 原因與解法 |
|---|---|
| 首頁「讀取成員失敗」 | `VITE_SUPABASE_URL`/`ANON_KEY` 沒設或打錯；Actions Variables 改完要重跑 workflow |
| 生成任務 403 | Worker 的 `ALLOWED_ORIGIN` 與 Pages 網域不一致（檢查 https、不含路徑） |
| 生成任務 401 | `ANTHROPIC_API_KEY` secret 沒設或失效，重新 `wrangler secret put` |
| 429 請稍後再試 | Worker 限流（同 IP 每分鐘 20 次），等一分鐘 |
| 手機沒聲音 | iOS 需先點過頁面任一按鈕才能播放；音量/靜音鍵確認 |
| 聲音很機械、發音設定看不到「雲端語音」 | `GOOGLE_TTS_API_KEY` 沒設、Text-to-Speech API 沒啟用、或專案沒開帳單。打開 Worker 的 `/health` 確認 `google_tts_key`，再用 `worker/README.md` 的 curl 測 `/api/gtts` 看實際錯誤 |
| 台語沒聲音、顯示「語音服務暫時無法使用」 | `YATING_API_KEY` 沒設或點數用完，打開 Worker 的 `/health` 確認 |
| 台語腳本存不進去（column does not exist） | `migration-008.sql` 沒跑 |
| 泛聽頁顯示「泛聽資料表還沒建立」 | `migration-009.sql` 沒跑 |
| 跑完 `migration-010` 後首頁一個成員都看不到 | 資料庫的密碼跟你輸入的不一致，或還沒在網站輸入過密碼。先確認 `app_secrets` 裡的值與 `ACCESS_PASSPHRASE` 相同；真的進不去用 `migration-010.sql` 最後面的「緊急還原」 |
| 台語跟讀按了沒反應 | 瀏覽器擋掉麥克風權限；Chrome 需在 https 或 localhost 下才給錄音 |
| 開站一直卡在密碼畫面，密碼明明是對的 | 檢查 `wrangler secret put ACCESS_PASSPHRASE` 有沒有打錯字或多打了空白；改完密碼要 `wrangler deploy` 才生效 |
| 用到一半突然又跳回密碼畫面 | 密碼被在別的裝置改掉了，重新輸入新密碼即可，不是壞掉 |
