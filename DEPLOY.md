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
     ⚠️ 已建過資料庫的人這幾段也要跑，否則會出現「column / table does not exist」

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
   npx wrangler secret put ANTHROPIC_API_KEY # 貼上 Anthropic API key（sk-ant- 開頭）
   npx wrangler secret put YATING_API_KEY    # 台語語音用，見下方第 6 點
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

> 台語語音每合成一句就花一次點數，所以 Worker 端用 Cloudflare Cache
> 依「句子＋音色＋語速」快取，同一句重聽或別台裝置再聽都不會再收費。

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
4. 完成後網址為 `https://<帳號>.github.io/lglearning/`

> 若 repo 改名，記得同步改 `vite.config.ts` 裡的 `base: '/lglearning/'`。

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
printf 'ANTHROPIC_API_KEY=sk-ant-你的key\nYATING_API_KEY=你的雅婷key\n' > .dev.vars
npx wrangler dev       # http://localhost:8787（自動允許 localhost Origin）
```

## 6. 上線驗收清單

- [ ] 首頁能看到成員A/成員B 卡片（Supabase 連線 OK）
- [ ] 點成員 → 生成任務成功（Worker + Claude API OK）
- [ ] 聽力頁能發音（TTS OK）
- [ ] 口說頁按住能辨識（STT OK；不支援的瀏覽器顯示鍵盤輸入）
- [ ] 寫作提交能拿到批改結果，錯誤出現在「錯誤庫」
- [ ] 完成任務回到首頁，隔天可再生成新任務
- [ ] 台語首頁「試聽」有聲音（雅婷 TTS OK）
- [ ] 台語生成腳本成功、逐句能播、跟讀能錄音並拿到分數
- [ ] 手機可「加入主畫面」，開啟後為全螢幕 App 樣式

## 常見問題

| 症狀 | 原因與解法 |
|---|---|
| 首頁「讀取成員失敗」 | `VITE_SUPABASE_URL`/`ANON_KEY` 沒設或打錯；Actions Variables 改完要重跑 workflow |
| 生成任務 403 | Worker 的 `ALLOWED_ORIGIN` 與 Pages 網域不一致（檢查 https、不含路徑） |
| 生成任務 401 | `ANTHROPIC_API_KEY` secret 沒設或失效，重新 `wrangler secret put` |
| 429 請稍後再試 | Worker 限流（同 IP 每分鐘 20 次），等一分鐘 |
| 手機沒聲音 | iOS 需先點過頁面任一按鈕才能播放；音量/靜音鍵確認 |
| 台語沒聲音、顯示「語音服務暫時無法使用」 | `YATING_API_KEY` 沒設或點數用完，打開 Worker 的 `/health` 確認 |
| 台語腳本存不進去（column does not exist） | `migration-008.sql` 沒跑 |
| 台語跟讀按了沒反應 | 瀏覽器擋掉麥克風權限；Chrome 需在 https 或 localhost 下才給錄音 |
