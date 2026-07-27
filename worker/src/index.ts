/**
 * Cloudflare Worker：Claude API 代理 ＋ 雅婷台語 TTS 代理
 * 唯一職責：藏 API key、轉發上游、簡單限流（CLAUDE.md 第 2/3 節）
 */

export interface Env {
  ANTHROPIC_API_KEY: string
  ALLOWED_ORIGIN: string
  /** 雅婷 TTS（台語語音來源，CLAUDE.md 第 10 節的例外，使用者已明確同意） */
  YATING_API_KEY: string
  /**
   * 全家共用的通關密碼，擋在會花錢的端點前面（不是帳號系統，只是防網址外流被盜用）。
   * 沒設的話這道關卡整個不啟用，向下相容還沒設定過的部署。
   */
  ACCESS_PASSPHRASE?: string
}

interface ChatRequestBody {
  model: string
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  max_tokens: number
}

interface TtsRequestBody {
  text: string
  /** 雅婷語音模型，見 YATING_MODELS */
  model?: string
  /** 0.5 ~ 1.5 */
  speed?: number
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const YATING_URL = 'https://tts.api.yating.tw/v2/speeches/short'
const RATE_LIMIT_PER_MINUTE = 20

/**
 * TTS 另外算一組額度：一段腳本會逐句合成，10 句就吃掉 10 次，
 * 跟聊天共用 20/分鐘 會在正常使用下就被擋掉。快取命中不計數。
 */
const TTS_RATE_LIMIT_PER_MINUTE = 60

/** 白名單，避免任意字串被當成 model 送到上游 */
const YATING_MODELS = new Set(['tai_female_1', 'tai_female_2', 'tai_male_1'])

/** 一次合成的字數上限，防止誤送整篇文章燒掉點數 */
const TTS_MAX_CHARS = 200

/** 每次改 Worker 就手動 +1，用來確認線上跑的是哪一版 */
const WORKER_VERSION = 4

/** 前端夾帶通關密碼的 header 名稱 */
const ACCESS_HEADER = 'x-lgl-access'

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
    'Access-Control-Allow-Headers': `content-type, ${ACCESS_HEADER}`,
    'Access-Control-Max-Age': '86400',
  }
}

/**
 * 通關密碼檢查。ACCESS_PASSPHRASE 沒設就不擋（向下相容還沒設定過的部署，
 * 就跟 YATING_API_KEY 沒設只影響台語模組一樣，這是選配功能不是必要條件）。
 */
function hasAccess(request: Request, env: Env): boolean {
  if (!env.ACCESS_PASSPHRASE) return true
  return request.headers.get(ACCESS_HEADER) === env.ACCESS_PASSPHRASE
}

function accessDeniedResponse(origin: string): Response {
  return jsonResponse(
    { error: 'access_denied', message: '通關密碼不對或已變更，請重新輸入' },
    401,
    origin,
  )
}

function jsonResponse(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders(origin) },
  })
}

function isRateLimited(ip: string, bucket = 'chat', limit = RATE_LIMIT_PER_MINUTE): boolean {
  const key = `${bucket}:${ip}`
  const now = Date.now()
  const windowStart = now - 60_000
  const hits = (rateBuckets.get(key) ?? []).filter((t) => t > windowStart)
  if (hits.length >= limit) {
    rateBuckets.set(key, hits)
    return true
  }
  hits.push(now)
  rateBuckets.set(key, hits)
  return false
}

/**
 * 快取鍵：同一句話用同一個語音、同一個語速，合成結果永遠一樣，
 * 不必每次都花雅婷的點數。用 FNV-1a 把內容壓成短字串當網址。
 */
function cacheKeyFor(text: string, model: string, speed: number): string {
  const raw = `${model}|${speed}|${text}`
  let hash = 2166136261
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `https://tts-cache.local/${model}/${speed}/${(hash >>> 0).toString(36)}-${raw.length}`
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** 台語語音合成：代理雅婷 TTS，回傳 audio/mpeg 位元組（不是 base64 JSON） */
async function handleTts(request: Request, env: Env, origin: string): Promise<Response> {
  if (!hasAccess(request, env)) return accessDeniedResponse(origin)

  if (!env.YATING_API_KEY) {
    return jsonResponse(
      {
        error: 'missing_tts_key',
        message: 'Worker 沒有讀到 YATING_API_KEY，請在 Cloudflare Worker Settings → Variables and Secrets 新增',
      },
      500,
      origin,
    )
  }

  let body: TtsRequestBody
  try {
    body = (await request.json()) as TtsRequestBody
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, origin)
  }

  const text = (body.text ?? '').trim()
  if (!text) return jsonResponse({ error: 'missing_text', message: '需要 text' }, 400, origin)
  if (text.length > TTS_MAX_CHARS) {
    return jsonResponse(
      { error: 'text_too_long', message: `一次最多 ${TTS_MAX_CHARS} 字，請先斷句再送` },
      400,
      origin,
    )
  }

  const model = body.model && YATING_MODELS.has(body.model) ? body.model : 'tai_female_1'
  // 雅婷只收 0.5~1.5，超出範圍會直接 400
  const speed = Math.min(1.5, Math.max(0.5, Number(body.speed) || 1))
  // 留兩位小數，避免浮點誤差把快取打散。位數要跟前端 clampTaigiSpeed 一致，
  // 一位的話 1.25 會被進位成 1.3，前後端算出來的快取鍵就對不起來了。
  const speedKey = Math.round(speed * 100) / 100

  const cache = caches.default
  const cacheRequest = new Request(cacheKeyFor(text, model, speedKey), { method: 'GET' })
  const cached = await cache.match(cacheRequest)
  if (cached) {
    // 快取命中不算額度，也不碰上游
    return new Response(cached.body, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'x-tts-cache': 'hit', ...corsHeaders(origin) },
    })
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (isRateLimited(ip, 'tts', TTS_RATE_LIMIT_PER_MINUTE)) {
    return jsonResponse({ error: 'rate_limited', message: '語音請求太頻繁，請一分鐘後再試' }, 429, origin)
  }

  let upstream: Response
  try {
    upstream = await fetch(YATING_URL, {
      method: 'POST',
      headers: { key: env.YATING_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        input: { text, type: 'text' },
        voice: { model, speed, pitch: 1, energy: 1 },
        audioConfig: { encoding: 'MP3', sampleRate: '16K' },
      }),
    })
  } catch {
    return jsonResponse({ error: 'tts_unreachable', message: '無法連線到語音服務' }, 502, origin)
  }

  const raw = await upstream.text()
  if (!upstream.ok) {
    return jsonResponse(
      {
        error: 'tts_failed',
        status: upstream.status,
        message:
          upstream.status === 401 || upstream.status === 403
            ? '雅婷 TTS 拒絕這把金鑰，請確認 YATING_API_KEY 正確且點數未用完'
            : `雅婷 TTS 回傳 ${upstream.status}`,
        upstream: raw.slice(0, 500),
      },
      upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status,
      origin,
    )
  }

  let audioContent = ''
  try {
    audioContent = (JSON.parse(raw) as { audioContent?: string }).audioContent ?? ''
  } catch {
    return jsonResponse({ error: 'tts_bad_response', message: '語音服務回傳格式異常' }, 502, origin)
  }
  if (!audioContent) {
    return jsonResponse({ error: 'tts_empty', message: '語音服務沒有回傳音訊' }, 502, origin)
  }

  const bytes = base64ToBytes(audioContent)
  // 存快取的那份要能被 Cloudflare 快取住，所以帶 max-age；回給瀏覽器的
  // 另外開一份（Response body 只能讀一次）
  const cacheHeaders = { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000' }
  await cache.put(cacheRequest, new Response(bytes, { headers: cacheHeaders }))
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'audio/mpeg', 'x-tts-cache': 'miss', ...corsHeaders(origin) },
  })
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
        JSON.stringify(
          {
            status: hasKey ? 'ok' : 'missing_key',
            worker_version: WORKER_VERSION,
            key_prefix: prefix,
            key_length: len,
            allowed_origin: origin_setting,
            // 台語語音用的是另一把 key，沒設的話台語模組會整個不能用
            yating_key: env.YATING_API_KEY ? `已設定（${env.YATING_API_KEY.length} 字元）` : '（未設定，台語語音無法使用）',
            // 通關密碼是選配的，沒設就代表任何人拿到網址都能直接用
            access_passphrase: env.ACCESS_PASSPHRASE ? '已設定（有通關密碼保護）' : '（未設定，任何人都能直接使用）',
          },
          null,
          2,
        ),
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

    if (url.pathname === '/api/tts' && request.method === 'POST') {
      return handleTts(request, env, origin)
    }

    // 前端在通關密碼輸入畫面用這支立即驗證對不對，不用等到真的送出一次
    // 任務生成才發現密碼錯——那樣使用者體驗很差且會浪費一次 AI 額度判斷失敗原因
    if (url.pathname === '/api/verify-access' && request.method === 'POST') {
      return hasAccess(request, env)
        ? jsonResponse({ ok: true }, 200, origin)
        : accessDeniedResponse(origin)
    }

    if (url.pathname !== '/api/chat' || request.method !== 'POST') {
      return jsonResponse({ error: 'not_found' }, 404, origin)
    }

    if (!hasAccess(request, env)) return accessDeniedResponse(origin)

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
