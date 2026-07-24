/**
 * Cloudflare Worker：Claude API 代理
 * 唯一職責：藏 API key、轉發 /v1/messages、簡單限流（CLAUDE.md 第 2/3 節）
 */

export interface Env {
  ANTHROPIC_API_KEY: string
  ALLOWED_ORIGIN: string
}

interface ChatRequestBody {
  model: string
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  max_tokens: number
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const RATE_LIMIT_PER_MINUTE = 20

// in-memory 限流：同一個 Worker isolate 內有效，自用規模足夠
const rateBuckets = new Map<string, number[]>()

function isAllowedOrigin(origin: string | null, env: Env): boolean {
  if (!origin) return false
  if (origin === env.ALLOWED_ORIGIN) return true
  // 開發模式允許 localhost / 127.0.0.1（任意 port）
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '86400',
  }
}

function jsonResponse(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
  })
}

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const windowStart = now - 60_000
  const hits = (rateBuckets.get(ip) ?? []).filter((t) => t > windowStart)
  if (hits.length >= RATE_LIMIT_PER_MINUTE) {
    rateBuckets.set(ip, hits)
    return true
  }
  hits.push(now)
  rateBuckets.set(ip, hits)
  return false
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    const url = new URL(request.url)

    // 診斷頁：瀏覽器直接打開 /health 即可看 key 是否設好
    if (url.pathname === '/health' && request.method === 'GET') {
      const hasKey = !!env.ANTHROPIC_API_KEY
      const prefix = hasKey ? env.ANTHROPIC_API_KEY.slice(0, 10) + '…' : '（未設定）'
      const len = hasKey ? env.ANTHROPIC_API_KEY.length : 0
      const origin_setting = env.ALLOWED_ORIGIN || '（未設定）'
      return new Response(
        JSON.stringify({ status: hasKey ? 'ok' : 'missing_key', key_prefix: prefix, key_length: len, allowed_origin: origin_setting }, null, 2),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }

    if (!origin || !isAllowedOrigin(origin, env)) {
      return new Response(JSON.stringify({ error: 'origin_not_allowed' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      })
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    if (url.pathname !== '/api/chat' || request.method !== 'POST') {
      return jsonResponse({ error: 'not_found' }, 404, origin)
    }

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
    if (isRateLimited(ip)) {
      return jsonResponse({ error: 'rate_limited', message: '請求太頻繁，請一分鐘後再試' }, 429, origin)
    }

    // 診斷：key 未設定時直接告知，避免無意義的 401
    if (!env.ANTHROPIC_API_KEY) {
      return jsonResponse(
        { error: 'missing_api_key', message: 'Worker 沒有讀到 ANTHROPIC_API_KEY，請在 Cloudflare Worker Settings → Variables and Secrets 新增' },
        500,
        origin,
      )
    }

    let body: ChatRequestBody
    try {
      body = (await request.json()) as ChatRequestBody
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400, origin)
    }

    if (!body.model || !Array.isArray(body.messages) || !body.max_tokens) {
      return jsonResponse({ error: 'missing_fields', message: '需要 model / messages / max_tokens' }, 400, origin)
    }

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: body.model,
        system: body.system,
        messages: body.messages,
        max_tokens: body.max_tokens,
      }),
    })

    const text = await upstream.text()

    // 診斷：401 時附加 key 前綴資訊協助排查（不暴露完整 key）
    if (upstream.status === 401) {
      const prefix = env.ANTHROPIC_API_KEY.slice(0, 7)
      const len = env.ANTHROPIC_API_KEY.length
      return jsonResponse(
        {
          error: 'anthropic_auth_failed',
          message: `Anthropic 回傳 401。key 前綴 "${prefix}…"（共 ${len} 字元）。請確認：1) key 以 sk-ant- 開頭 2) 在 console.anthropic.com 仍為有效狀態`,
          upstream: JSON.parse(text),
        },
        401,
        origin,
      )
    }

    return new Response(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
    })
  },
}
