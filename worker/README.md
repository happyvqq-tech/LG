# lglearning-worker — Claude API 代理

唯一職責：把前端的 `/api/chat` 請求轉發到 Anthropic，API key 只存在 Worker 環境變數。

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

## 部署

```bash
cd worker
npx wrangler login                       # 第一次需要
npx wrangler secret put ANTHROPIC_API_KEY  # 貼上正式 key
# 編輯 wrangler.toml 的 ALLOWED_ORIGIN 為 GitHub Pages 網址
npx wrangler deploy
```

部署後把網址（`https://lglearning-worker.<帳號>.workers.dev`）填入前端 `.env` 的 `VITE_WORKER_URL`。

## 限流

同一 IP 每分鐘 20 次，超過回 `429`。使用 in-memory Map，Worker isolate 回收即重置——自用規模足夠。
