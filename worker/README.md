# lglearning-worker — Claude API ＋ 語音代理

唯一職責：把前端的請求轉發到上游，各家 API key 只存在 Worker 環境變數。

| 端點 | 上游 | 用途 |
|---|---|---|
| `POST /api/chat` | api.anthropic.com | Claude API |
| `POST /api/gtts` | texttospeech.googleapis.com | 英日韓語音合成（回 `audio/mpeg`） |
| `POST /api/gtts/voices` | texttospeech.googleapis.com | 可用音色清單（快取一天） |
| `POST /api/tts` | tts.api.yating.tw | 台語語音（回 `audio/mpeg`） |
| `GET /health` | — | 確認各把金鑰是否設好、線上跑的是哪一版 |

## 本地開發測試

```bash
cd worker
npm install

# 本地開發用的 API key（.dev.vars 已在 .gitignore，不會進 git）
echo 'ANTHROPIC_API_KEY=sk-ant-你的key' > .dev.vars

npx wrangler dev   # 預設 http://localhost:8787
```

### curl 測試（成功案例）

```bash
curl -s http://localhost:8787/api/chat \
  -X POST \
  -H 'Origin: http://localhost:5173' \
  -H 'content-type: application/json' \
  -d '{
    "model": "claude-haiku-4-5",
    "system": "你是測試助手，回覆一句話即可",
    "messages": [{"role": "user", "content": "說 hello"}],
    "max_tokens": 100
  }'
```

預期：回傳 Anthropic 原始 JSON（`content[0].text` 內有回覆）。

### curl 測試（Origin 被拒）

```bash
curl -s -i http://localhost:8787/api/chat \
  -X POST \
  -H 'Origin: https://evil.example.com' \
  -H 'content-type: application/json' \
  -d '{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'
```

預期：`403` + `{"error":"origin_not_allowed"}`。不帶 Origin header 也會被拒。

### curl 測試（Google 語音）

```bash
# 可用音色
curl -s http://localhost:8787/api/gtts/voices \
  -X POST -H 'Origin: http://localhost:5173' -H 'content-type: application/json' \
  -d '{"languageCode":"en"}' | head -c 400

# 合成一句（存成 mp3 直接聽）
curl -s http://localhost:8787/api/gtts \
  -X POST -H 'Origin: http://localhost:5173' -H 'content-type: application/json' \
  -d '{"text":"Hello, how are you today?","voice":"en-US-Chirp3-HD-Aoede"}' \
  -o /tmp/gtts.mp3 && file /tmp/gtts.mp3
```

`voice` 要從第一支端點回傳的清單裡挑，音色名稱打錯會被格式驗證擋成 `400 bad_voice`，
或由 Google 回 `400`。第二次跑同一句會走快取（回應 header `x-gtts-cache: hit`），不花額度。

## 部署

```bash
cd worker
npx wrangler login                          # 第一次需要
npx wrangler secret put ANTHROPIC_API_KEY   # Claude API
npx wrangler secret put GOOGLE_TTS_API_KEY  # 英日韓語音（沒設會自動退回瀏覽器語音）
# 編輯 wrangler.toml 的 ALLOWED_ORIGIN 為 GitHub Pages 網址
npx wrangler deploy
```

部署後把網址（`https://lglearning-worker.<帳號>.workers.dev`）填入前端 `.env` 的 `VITE_WORKER_URL`。

## 限流

`/api/chat` 同一 IP 每分鐘 20 次；語音端點另外算一組，每分鐘 60 次（一段腳本會逐句合成，
跟聊天共用額度會在正常使用下就被擋掉）。超過回 `429`。快取命中不計數。
使用 in-memory Map，Worker isolate 回收即重置——自用規模足夠。

## 語音快取與成本

兩支 TTS 端點都用 Cloudflare Cache 存合成結果，快取鍵是「句子＋音色」。
Google 這邊刻意不把語速放進快取鍵——一律用 1.0 倍速合成，語速由前端的
`audio.playbackRate` 處理，所以 SpeedPicker 的 5 檔速度共用同一份音檔。

Google 每月前 100 萬字元免費（Chirp 3 HD 之後為 $30/1M）。四人家庭每天一個任務
約 12 萬字元/月，遠在免費額度內，但還是建議去 GCP 帳單頁設一個預算警示。
