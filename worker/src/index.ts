/**
 * Cloudflare Worker：Claude API 代理 ＋ 雅婷台語 TTS 代理 ＋ Google Cloud TTS 代理
 * 唯一職責：藏 API key、轉發上游、簡單限流（CLAUDE.md 第 2/3 節）
 */

import { isPromptModule, resolvePrompt, type ModelRequestOptions } from './prompts'
import { extractArticle } from './articleExtract'
import { mergeFeeds, parseFeed, type FeedItem } from './rss'
import { GEMINI_MODELS, transcribeWithGemini } from './geminiTranscribe'
import {
  pickPlayable,
  playProblem,
  toDetail,
  VIEWER_REGION,
  type VideoDetail,
  type VideoKind,
} from './youtubeFilter'
import {
  extractCaptionTracks,
  json3ToPanelText,
  LANG_CODE,
  pickTrack,
  type TranscriptMiss,
} from './youtubeCaptions'

export interface Env {
  ANTHROPIC_API_KEY: string
  ALLOWED_ORIGIN: string
  /** 雅婷 TTS（台語語音來源，CLAUDE.md 第 10 節的例外，使用者已明確同意） */
  YATING_API_KEY: string
  /** Google Cloud Text-to-Speech（英日韓的真人感語音，CLAUDE.md 第 10 節的例外） */
  GOOGLE_TTS_API_KEY: string
  /**
   * 全家共用的通關密碼，擋在會花錢的端點前面（不是帳號系統，只是防網址外流被盜用）。
   * 沒設的話這道關卡整個不啟用，向下相容還沒設定過的部署。
   */
  ACCESS_PASSPHRASE?: string
  /**
   * YouTube Data API v3（歌曲模組用來找原曲影片）。選配——沒設的話前端會改成
   * 請使用者自己貼一次 YouTube 連結，歌曲模組照常可用。
   * 可以直接沿用 GCP 上那把 Google 金鑰，只要在金鑰的 API 限制裡
   * 多勾一個 YouTube Data API v3 即可，不必另外開一把。
   */
  YOUTUBE_API_KEY?: string
  /**
   * Google Gemini API（影片逐字稿的第二層：讓 AI 直接聽影片，見 geminiTranscribe.ts）。
   * 選配——沒設就跟以前一樣，抓不到字幕時請使用者自己貼。
   * 可以沿用 GCP 上那把 Google 金鑰，在金鑰的 API 限制裡多勾 Generative Language API；
   * 那個專案有綁帳單，所以走付費額度（每支影片不到一塊台幣，內容不會被拿去訓練）。
   * 也可以在 Google AI Studio 另開一把免費的（每天 8 小時影片，但內容可能被拿去改善產品）。
   */
  GEMINI_API_KEY?: string
  /** 選配：指定 Gemini 模型名稱，會排在內建清單前面先試 */
  GEMINI_MODEL?: string
}

interface ChatRequestBody {
  /** 新版：由 Worker 依模組組裝 system prompt 並決定模型（見 prompts/index.ts） */
  prompt?: { module?: unknown; vars?: unknown }
  /**
   * 舊版：前端直接送完整的 system 與 model。
   *
   * 保留它不是為了相容性潔癖，是因為這是 PWA——Service Worker 會把舊版
   * 前端的 JS 快取在使用者裝置上，家人手機裡可能好幾天都還跑著舊版。
   * 舊前端配新 Worker 必須繼續能用，否則等於在他們沒做錯任何事的情況下
   * 把 App 弄壞。等大家都更新過之後可以移除這條路徑。
   */
  model?: string
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  max_tokens?: number
}

interface TtsRequestBody {
  text: string
  /** 雅婷語音模型，見 YATING_MODELS */
  model?: string
  /** 0.5 ~ 1.5 */
  speed?: number
}

interface GttsRequestBody {
  text: string
  /** Google 語音全名，例如 en-US-Chirp3-HD-Aoede */
  voice: string
}

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const YATING_URL = 'https://tts.api.yating.tw/v2/speeches/short'
const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'
const GOOGLE_VOICES_URL = 'https://texttospeech.googleapis.com/v1/voices'
/**
 * LRCLIB：社群維護的歌詞資料庫，免費且不需要金鑰，而且回傳的是
 * 逐句帶時間戳的同步歌詞（LRC）——那比單純的歌詞值錢得多，
 * 有時間戳才能「只循環播這一段」。
 *
 * 為什麼不用別家：Genius 的官方 API 根本不回傳歌詞（只有 metadata），
 * Musixmatch 免費方案只給 30% 的歌詞。兩者都不適合。
 */
const LRCLIB_URL = 'https://lrclib.net/api'
const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search'
const YOUTUBE_WATCH_URL = 'https://www.youtube.com/watch'
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos'
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

/**
 * Google TTS 只開放英日韓（CLAUDE.md 第 2 節）。古文走瀏覽器語音、台語走雅婷，
 * 都不該打到這裡；限制語系同時也擋掉「拿這支端點當通用 TTS 用」。
 */
const GOOGLE_ALLOWED_LANGS = new Set(['en', 'ja', 'ko'])

/**
 * 語音名稱格式：{lang}-{REGION}-{系列}-{音色}，例如 en-US-Chirp3-HD-Aoede。
 * 不維護一份完整白名單的原因：Google 會持續新增音色，寫死清單只會讓前端
 * 從 /api/gtts/voices 拿到的新音色在這裡被擋掉。用格式驗證＋語系白名單，
 * 既擋掉任意字串，也不必跟著上游更新。
 */
const GOOGLE_VOICE_PATTERN = /^[a-z]{2}-[A-Z]{2}-[A-Za-z0-9-]{1,40}$/

/** 聽力稿是逐句合成的，一句遠低於這個上限；設 500 是避免整篇被當一句送上去 */
const GTTS_MAX_CHARS = 500

/** 每次改 Worker 就手動 +1，用來確認線上跑的是哪一版 */
const WORKER_VERSION = 22

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
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
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
function fnv1a(raw: string): string {
  let hash = 2166136261
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function cacheKeyFor(text: string, model: string, speed: number): string {
  const raw = `${model}|${speed}|${text}`
  return `https://tts-cache.local/${model}/${speed}/${fnv1a(raw)}-${raw.length}`
}

/**
 * Google 這邊沒有 speed 維度：一律用 1.0 倍速合成，語速由前端的
 * audio.playbackRate 處理。同一句因此只會有一份音檔，快取命中率是雅婷那邊的 5 倍
 * （SpeedPicker 有 5 檔速度）。
 */
function gttsCacheKeyFor(text: string, voice: string): string {
  const raw = `${voice}|${text}`
  return `https://gtts-cache.local/${voice}/${fnv1a(raw)}-${raw.length}`
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

/** 語音名稱前兩段就是 languageCode（en-US-Chirp3-HD-Aoede → en-US） */
function languageCodeOf(voice: string): string {
  return voice.split('-').slice(0, 2).join('-')
}

function googleKeyMissing(origin: string): Response {
  return jsonResponse(
    {
      error: 'missing_google_key',
      message:
        'Worker 沒有讀到 GOOGLE_TTS_API_KEY，請在 Cloudflare Worker Settings → Variables and Secrets 新增',
    },
    500,
    origin,
  )
}

/**
 * 可用語音清單：直接問 Google，不在程式裡寫死音色名單。
 * Google 會持續新增音色（Chirp 3 HD 尤其頻繁），寫死清單遲早會過期，
 * 而且打錯一個字就是 400。清單快取一天，前端每次開發音設定不會真的打上游。
 */
async function handleGoogleVoices(request: Request, env: Env, origin: string): Promise<Response> {
  if (!hasAccess(request, env)) return accessDeniedResponse(origin)
  if (!env.GOOGLE_TTS_API_KEY) return googleKeyMissing(origin)

  let body: { languageCode?: string }
  try {
    body = (await request.json()) as { languageCode?: string }
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, origin)
  }

  const languageCode = body.languageCode ?? ''
  if (!GOOGLE_ALLOWED_LANGS.has(languageCode.slice(0, 2))) {
    return jsonResponse(
      { error: 'lang_not_allowed', message: 'Google 語音只開放英文／日文／韓文' },
      400,
      origin,
    )
  }

  const cache = caches.default
  const cacheRequest = new Request(`https://gtts-voices.local/${languageCode}`, { method: 'GET' })
  const cached = await cache.match(cacheRequest)
  if (cached) {
    return new Response(cached.body, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-gtts-cache': 'hit', ...corsHeaders(origin) },
    })
  }

  let upstream: Response
  try {
    upstream = await fetch(
      `${GOOGLE_VOICES_URL}?key=${encodeURIComponent(env.GOOGLE_TTS_API_KEY)}&languageCode=${encodeURIComponent(languageCode)}`,
    )
  } catch {
    return jsonResponse({ error: 'gtts_unreachable', message: '無法連線到語音服務' }, 502, origin)
  }

  const raw = await upstream.text()
  if (!upstream.ok) {
    return jsonResponse(
      {
        error: 'gtts_voices_failed',
        status: upstream.status,
        message:
          upstream.status === 400 || upstream.status === 403
            ? 'Google 拒絕這把金鑰，請確認 GOOGLE_TTS_API_KEY 有效且已啟用 Text-to-Speech API'
            : `Google 語音清單回傳 ${upstream.status}`,
        upstream: raw.slice(0, 500),
      },
      502,
      origin,
    )
  }

  await cache.put(
    cacheRequest,
    new Response(raw, {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' },
    }),
  )
  return new Response(raw, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'x-gtts-cache': 'miss', ...corsHeaders(origin) },
  })
}

/** 英日韓語音合成：代理 Google Cloud TTS，回傳 audio/mpeg 位元組 */
async function handleGtts(request: Request, env: Env, origin: string): Promise<Response> {
  // Google TTS 是這次改動之後才有的端點，原本那版通關密碼沒擋到它。
  // 它一樣會花錢（超過免費額度後 $30/1M 字元），一樣要擋
  if (!hasAccess(request, env)) return accessDeniedResponse(origin)
  if (!env.GOOGLE_TTS_API_KEY) return googleKeyMissing(origin)

  let body: GttsRequestBody
  try {
    body = (await request.json()) as GttsRequestBody
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, origin)
  }

  const text = (body.text ?? '').trim()
  if (!text) return jsonResponse({ error: 'missing_text', message: '需要 text' }, 400, origin)
  if (text.length > GTTS_MAX_CHARS) {
    return jsonResponse(
      { error: 'text_too_long', message: `一次最多 ${GTTS_MAX_CHARS} 字，請先斷句再送` },
      400,
      origin,
    )
  }

  const voice = body.voice ?? ''
  if (!GOOGLE_VOICE_PATTERN.test(voice) || !GOOGLE_ALLOWED_LANGS.has(voice.slice(0, 2))) {
    return jsonResponse(
      { error: 'bad_voice', message: '語音名稱格式不正確，或不是英文／日文／韓文的語音' },
      400,
      origin,
    )
  }

  const cache = caches.default
  const cacheRequest = new Request(gttsCacheKeyFor(text, voice), { method: 'GET' })
  const cached = await cache.match(cacheRequest)
  if (cached) {
    // 快取命中不算額度，也不碰上游
    return new Response(cached.body, {
      status: 200,
      headers: { 'content-type': 'audio/mpeg', 'x-gtts-cache': 'hit', ...corsHeaders(origin) },
    })
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (isRateLimited(ip, 'gtts', TTS_RATE_LIMIT_PER_MINUTE)) {
    return jsonResponse({ error: 'rate_limited', message: '語音請求太頻繁，請一分鐘後再試' }, 429, origin)
  }

  let upstream: Response
  try {
    upstream = await fetch(`${GOOGLE_TTS_URL}?key=${encodeURIComponent(env.GOOGLE_TTS_API_KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        input: { text },
        // 不送 speakingRate：一律 1.0 合成，語速交給前端 playbackRate（見 gttsCacheKeyFor）
        voice: { languageCode: languageCodeOf(voice), name: voice },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    })
  } catch {
    return jsonResponse({ error: 'gtts_unreachable', message: '無法連線到語音服務' }, 502, origin)
  }

  const raw = await upstream.text()
  if (!upstream.ok) {
    return jsonResponse(
      {
        error: 'gtts_failed',
        status: upstream.status,
        message:
          upstream.status === 400 || upstream.status === 403
            ? 'Google 拒絕這次請求，請確認 GOOGLE_TTS_API_KEY 有效、已啟用 Text-to-Speech API 且帳單額度未用完'
            : `Google TTS 回傳 ${upstream.status}`,
        upstream: raw.slice(0, 500),
      },
      502,
      origin,
    )
  }

  let audioContent = ''
  try {
    audioContent = (JSON.parse(raw) as { audioContent?: string }).audioContent ?? ''
  } catch {
    return jsonResponse({ error: 'gtts_bad_response', message: '語音服務回傳格式異常' }, 502, origin)
  }
  if (!audioContent) {
    return jsonResponse({ error: 'gtts_empty', message: '語音服務沒有回傳音訊' }, 502, origin)
  }

  const bytes = base64ToBytes(audioContent)
  const cacheHeaders = { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=31536000' }
  await cache.put(cacheRequest, new Response(bytes, { headers: cacheHeaders }))
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'audio/mpeg', 'x-gtts-cache': 'miss', ...corsHeaders(origin) },
  })
}

/**
 * 歌詞查詢：代理 LRCLIB。
 *
 * 為什麼要經過 Worker 而不讓前端直接打：一來可以用 Cloudflare Cache 把結果
 * 快取起來（同一首歌全家只查一次），二來不確定 LRCLIB 的 CORS 標頭，
 * 經過自己的 Worker 就不必賭。
 *
 * 查不到不是錯誤：社群資料庫本來就不可能收錄所有歌，前端會改成請使用者貼歌詞。
 */
async function handleLyrics(request: Request, env: Env, origin: string): Promise<Response> {
  if (!hasAccess(request, env)) return accessDeniedResponse(origin)

  let body: { track?: string; artist?: string }
  try {
    body = (await request.json()) as { track?: string; artist?: string }
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, origin)
  }

  const track = (body.track ?? '').trim().slice(0, 120)
  const artist = (body.artist ?? '').trim().slice(0, 120)
  if (!track || !artist) {
    return jsonResponse({ error: 'missing_query', message: '需要 track 與 artist' }, 400, origin)
  }

  const cache = caches.default
  const cacheRequest = new Request(
    `https://lyrics-cache.local/${fnv1a(`${artist}|${track}`)}-${track.length}`,
    { method: 'GET' },
  )
  const cached = await cache.match(cacheRequest)
  if (cached) {
    return new Response(cached.body, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-lyrics-cache': 'hit', ...corsHeaders(origin) },
    })
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (isRateLimited(ip, 'lyrics', 30)) {
    return jsonResponse({ error: 'rate_limited', message: '查詢太頻繁，請一分鐘後再試' }, 429, origin)
  }

  // LRCLIB 要求帶上可辨識的 User-Agent，這是它文件寫明的禮貌要求
  const headers = { 'user-agent': 'LG-family-language-app (https://github.com/happyvqq-tech/LG)' }

  async function lookup(path: string): Promise<unknown> {
    const res = await fetch(`${LRCLIB_URL}${path}`, { headers })
    if (!res.ok) return null
    return (await res.json()) as unknown
  }

  let hit: Record<string, unknown> | null = null
  try {
    const q = `track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`
    // 先用精確比對；查不到再退回模糊搜尋取第一筆（歌名常有 - Remastered 之類的後綴）
    const exact = (await lookup(`/get?${q}`)) as Record<string, unknown> | null
    if (exact && typeof exact === 'object') hit = exact
    if (!hit) {
      const list = (await lookup(`/search?${q}`)) as unknown
      if (Array.isArray(list) && list.length > 0) hit = list[0] as Record<string, unknown>
    }
  } catch {
    return jsonResponse({ error: 'lyrics_unreachable', message: '無法連線到歌詞服務' }, 502, origin)
  }

  const plain = typeof hit?.plainLyrics === 'string' ? hit.plainLyrics : ''
  const synced = typeof hit?.syncedLyrics === 'string' ? hit.syncedLyrics : ''
  if (!plain && !synced) {
    return jsonResponse(
      { error: 'lyrics_not_found', message: '這首歌的歌詞查不到，請自己貼上' },
      404,
      origin,
    )
  }

  const payload = JSON.stringify({
    plain,
    synced,
    matchedTitle: typeof hit?.trackName === 'string' ? hit.trackName : track,
    matchedArtist: typeof hit?.artistName === 'string' ? hit.artistName : artist,
    source: 'LRCLIB',
  })
  const response = new Response(payload, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'max-age=2592000' },
  })
  await cache.put(cacheRequest, response.clone())
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  })
}

/**
 * 找原曲的 YouTube 影片。選配功能：沒設 YOUTUBE_API_KEY 就回 501，
 * 前端改成請使用者自己貼一次連結——歌曲模組照常可用，只是多一個動作。
 *
 * 不自己放音檔是版權考量：YouTube 官方嵌入是乾淨的做法（創作者照樣拿到收益）。
 */
async function handleYouTube(request: Request, env: Env, origin: string): Promise<Response> {
  if (!hasAccess(request, env)) return accessDeniedResponse(origin)
  if (!env.YOUTUBE_API_KEY) {
    return jsonResponse(
      { error: 'youtube_not_configured', message: '沒有設定 YOUTUBE_API_KEY' },
      501,
      origin,
    )
  }

  let body: { q?: string; kind?: string; language?: string }
  try {
    body = (await request.json()) as { q?: string; kind?: string; language?: string }
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, origin)
  }

  const q = (body.q ?? '').trim().slice(0, 150)
  if (!q) return jsonResponse({ error: 'missing_query', message: '需要 q' }, 400, origin)
  // 舊版前端不帶 kind，那時只有歌曲模組會呼叫這支
  const kind: VideoKind = body.kind === 'video' ? 'video' : 'song'
  const lang = LANG_CODE[body.language ?? ''] ?? ''

  const cache = caches.default
  const cacheKey = `${kind}|${lang}|${q}`
  const cacheRequest = new Request(`https://yt-cache.local/v2/${fnv1a(cacheKey)}-${cacheKey.length}`, {
    method: 'GET',
  })
  const cached = await cache.match(cacheRequest)
  if (cached) {
    return new Response(cached.body, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-yt-cache': 'hit', ...corsHeaders(origin) },
    })
  }

  // YouTube 搜尋一次要 100 單位配額（每日免費 10,000），快取就是在省這個
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (isRateLimited(ip, 'yt', 10)) {
    return jsonResponse({ error: 'rate_limited', message: '查詢太頻繁，請一分鐘後再試' }, 429, origin)
  }

  const key = encodeURIComponent(env.YOUTUBE_API_KEY)

  // 第一步：搜尋。能在搜尋階段就擋掉的先擋——可嵌入、可在站外播放、台灣看得到；
  // 影片模組另外限定 4-20 分鐘（順便擋掉 Shorts）。多拿幾支，下一步才有得挑
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: '8',
    videoEmbeddable: 'true',
    videoSyndicated: 'true',
    regionCode: VIEWER_REGION,
    safeSearch: 'moderate',
    q,
  })
  if (lang) params.set('relevanceLanguage', lang)
  if (kind === 'video') params.set('videoDuration', 'medium')

  let searchRaw: string
  try {
    const res = await fetch(`${YOUTUBE_SEARCH_URL}?${params}&key=${key}`)
    searchRaw = await res.text()
    if (!res.ok) return youtubeFailed(res.status, searchRaw, origin)
  } catch {
    return jsonResponse({ error: 'youtube_unreachable', message: '無法連線到 YouTube' }, 502, origin)
  }

  let ids: string[] = []
  try {
    const parsed = JSON.parse(searchRaw) as { items?: Array<{ id?: { videoId?: string } }> }
    ids = (parsed.items ?? []).map((it) => it.id?.videoId ?? '').filter(Boolean)
  } catch {
    // 解析不出來就當成找不到
  }
  if (ids.length === 0) {
    return jsonResponse({ error: 'video_not_found', message: '找不到影片' }, 404, origin)
  }

  // 第二步：逐支確認。搜尋參數擋不住年齡限制與「公開但不能嵌入」的漏網之魚，
  // 而 videos.list 只要 1 單位配額，幾乎不花成本
  let details: VideoDetail[] = []
  try {
    const res = await fetch(
      `${YOUTUBE_VIDEOS_URL}?part=snippet,status,contentDetails&id=${ids.join(',')}&key=${key}`,
    )
    const raw = await res.text()
    if (!res.ok) return youtubeFailed(res.status, raw, origin)
    const parsed = JSON.parse(raw) as { items?: unknown[] }
    // videos.list 不保證照 id 的順序回來，照搜尋的相關度排序重排
    const byId = new Map(
      (parsed.items ?? []).map((it) => toDetail(it)).filter((d): d is VideoDetail => d !== null).map((d) => [d.id, d]),
    )
    details = ids.map((id) => byId.get(id)).filter((d): d is VideoDetail => d !== undefined)
  } catch {
    return jsonResponse({ error: 'youtube_unreachable', message: '無法連線到 YouTube' }, 502, origin)
  }

  const best = pickPlayable(details, kind)
  if (!best) {
    return jsonResponse(
      { error: 'video_not_found', reason: 'none_playable', message: '搜到的影片都不能在 App 裡播放' },
      404,
      origin,
    )
  }

  const payload = JSON.stringify({
    videoId: best.id,
    videoTitle: best.title,
    durationSec: best.durationSec,
    hasCaptions: best.hasCaptions,
  })
  await cache.put(
    cacheRequest,
    new Response(payload, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'max-age=2592000' },
    }),
  )
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  })
}

function youtubeFailed(status: number, raw: string, origin: string): Response {
  return jsonResponse(
    {
      error: 'youtube_failed',
      status,
      message:
        status === 403
          ? 'YouTube 拒絕這把金鑰，請確認已啟用 YouTube Data API v3 且配額未用完'
          : `YouTube 回傳 ${status}`,
      upstream: raw.slice(0, 300),
    },
    502,
    origin,
  )
}

/**
 * 檢查單一支影片在 App 裡播不播得出來（使用者自己貼連結時用）。
 *
 * 有 YOUTUBE_API_KEY 就用 videos.list 做完整檢查（嵌入、地區、年齡、長度）；
 * 沒有的話退回 YouTube 的 oEmbed——免金鑰，而且它對「作者關掉嵌入」的影片
 * 會回 401，剛好就是最常見的那一種播不出來。其他情況回「不知道」，不擋人。
 */
async function handleVideoCheck(request: Request, env: Env, origin: string): Promise<Response> {
  if (!hasAccess(request, env)) return accessDeniedResponse(origin)

  let body: { videoId?: string; kind?: string }
  try {
    body = (await request.json()) as { videoId?: string; kind?: string }
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, origin)
  }
  const videoId = (body.videoId ?? '').trim()
  if (!/^[\w-]{11}$/.test(videoId)) {
    return jsonResponse({ error: 'missing_query', message: '需要 11 碼的 videoId' }, 400, origin)
  }
  const kind: VideoKind = body.kind === 'song' ? 'song' : 'video'

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (isRateLimited(ip, 'video-check', 30)) {
    return jsonResponse({ error: 'rate_limited', message: '查詢太頻繁，請一分鐘後再試' }, 429, origin)
  }

  const reply = (payload: Record<string, unknown>) => jsonResponse(payload, 200, origin)

  if (env.YOUTUBE_API_KEY) {
    try {
      const res = await fetch(
        `${YOUTUBE_VIDEOS_URL}?part=snippet,status,contentDetails&id=${videoId}` +
          `&key=${encodeURIComponent(env.YOUTUBE_API_KEY)}`,
      )
      if (res.ok) {
        const parsed = (await res.json()) as { items?: unknown[] }
        const d = parsed.items?.[0] ? toDetail(parsed.items[0]) : null
        if (!d) return reply({ checked: 'full', playable: false, problem: 'not_public' })
        const problem = playProblem(d, kind)
        return reply({
          checked: 'full',
          playable: problem === null,
          problem,
          title: d.title,
          durationSec: d.durationSec,
          hasCaptions: d.hasCaptions,
        })
      }
    } catch {
      // 退回下面的 oEmbed
    }
  }

  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
    )
    if (res.ok) {
      const data = (await res.json()) as { title?: string }
      return reply({ checked: 'basic', playable: true, problem: null, title: data.title ?? '' })
    }
    if (res.status === 401 || res.status === 403) {
      return reply({ checked: 'basic', playable: false, problem: 'embed_disabled' })
    }
    if (res.status === 404 || res.status === 400) {
      return reply({ checked: 'basic', playable: false, problem: 'not_public' })
    }
  } catch {
    // 連不上就當作不知道
  }
  return reply({ checked: 'none', playable: null, problem: null })
}

// ─────────────────────────────────────────────────────────────
// 影片逐字稿：盡力試抓一次
//
// 先說清楚期望值：**這支常常會失敗，而且那是正常的。**
// YouTube 這兩年鎖了兩道關，兩道都不是我們繞得過的：
//
//   1. PO token——字幕網址帶 exp=xpe 的影片，不附上播放器簽出來的 token
//      就只會回 200 加空內容。那個 token 是 BotGuard 挑戰算出來的，
//      沒有公開做法可以在 Worker 裡產生
//   2. 機房 IP——AWS／GCP／Cloudflare 的 IP 段會收到「Sign in to confirm
//      you're not a bot」。Worker 正好就是機房 IP。社群的解法是住宅代理，那要錢
//
// 那為什麼還要做？因為**失敗的成本是零**：抓不到就安靜退回「請貼上」，
// 跟沒有這支一模一樣；抓得到就省一次手動複製。不在 PO token 名單內的
// 舊影片還是有機會過。
//
// 官方 API 不是選項：captions.download 只有影片擁有者能呼叫。
// 前端自己抓也不是選項：youtube.com 不回 CORS 標頭，瀏覽器在你讀到
// 內容之前就把回應丟掉了（所以才另外給書籤小工具——那個是在 YouTube
// 自己的頁面上跑，讀的是播放器已經渲染好的轉錄稿面板，沒有這些問題）。
// ─────────────────────────────────────────────────────────────

async function handleTranscript(request: Request, env: Env, origin: string): Promise<Response> {
  if (!hasAccess(request, env)) return accessDeniedResponse(origin)

  let body: { videoId?: string; language?: string }
  try {
    body = (await request.json()) as { videoId?: string; language?: string }
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, origin)
  }

  const videoId = (body.videoId ?? '').trim()
  if (!/^[\w-]{11}$/.test(videoId)) {
    return jsonResponse({ error: 'missing_query', message: '需要 11 碼的 videoId' }, 400, origin)
  }
  const wanted = LANG_CODE[body.language ?? ''] ?? ''

  const cache = caches.default
  const cacheRequest = new Request(`https://yt-transcript.local/${videoId}-${wanted || 'any'}`, {
    method: 'GET',
  })
  const cached = await cache.match(cacheRequest)
  if (cached) {
    return new Response(cached.body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-transcript-cache': 'hit',
        ...corsHeaders(origin),
      },
    })
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (isRateLimited(ip, 'transcript', 20)) {
    return jsonResponse({ error: 'rate_limited', message: '查詢太頻繁，請一分鐘後再試' }, 429, origin)
  }

  // 失敗刻意不快取：擋 IP 跟 PO token 都可能是一時的，
  // 快取起來等於把一次壞運氣變成一個月都抓不到
  async function succeed(payload: Record<string, unknown>): Promise<Response> {
    const json = JSON.stringify(payload)
    await cache.put(
      cacheRequest,
      new Response(json, {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'max-age=2592000' },
      }),
    )
    return new Response(json, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
    })
  }

  // 第一層：免費試抓 YouTube 自己的字幕檔。抓得到最好（可能是人工字幕，而且瞬間就好）
  const scraped = await scrapeCaptions(videoId, wanted)
  if (scraped.ok) {
    return succeed({ text: scraped.text, lang: scraped.lang, auto: scraped.auto, source: 'youtube' })
  }

  // 第二層：讓 Gemini 直接聽影片（見 geminiTranscribe.ts）。選配——沒設金鑰就停在這裡
  if (!env.GEMINI_API_KEY) {
    return jsonResponse(
      { error: 'transcript_not_found', reason: scraped.reason, ai: 'not_configured' },
      scraped.status,
      origin,
    )
  }
  // 這一層會花錢（很少，但不是零）也比較慢，限流比第一層緊
  if (isRateLimited(ip, 'transcript-ai', 6)) {
    return jsonResponse({ error: 'rate_limited', message: 'AI 聽寫太頻繁，請一分鐘後再試' }, 429, origin)
  }
  const models = env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...GEMINI_MODELS] : GEMINI_MODELS
  const heard = await transcribeWithGemini({
    videoId,
    language: body.language ?? '',
    apiKey: env.GEMINI_API_KEY,
    models,
  })
  if (heard.ok) {
    return succeed({ text: heard.text, lang: wanted, auto: true, source: 'ai', model: heard.model })
  }
  return jsonResponse(
    { error: 'transcript_not_found', reason: scraped.reason, ai: heard.reason, ai_detail: heard.detail },
    502,
    origin,
  )
}

type ScrapeResult =
  | { ok: true; text: string; lang: string; auto: boolean }
  | { ok: false; reason: TranscriptMiss; status: number }

/** 第一層：去 youtube.com 挖字幕檔。常被擋，理由見 handleTranscript 上方的說明 */
async function scrapeCaptions(videoId: string, wanted: string): Promise<ScrapeResult> {
  const miss = (reason: TranscriptMiss, status = 404): ScrapeResult => ({ ok: false, reason, status })

  const browserish = {
    'user-agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'accept-language': 'en-US,en;q=0.9',
  }

  let html: string
  try {
    // bpctr 與 has_verified 是為了跳過年齡／同意的中介頁
    const res = await fetch(
      `${YOUTUBE_WATCH_URL}?v=${encodeURIComponent(videoId)}&hl=en&bpctr=9999999999&has_verified=1`,
      { headers: browserish },
    )
    if (!res.ok) return miss('blocked', 502)
    html = await res.text()
  } catch {
    return miss('unreachable', 502)
  }

  if (html.includes('Sign in to confirm') || html.includes('consent.youtube.com')) {
    return miss('blocked', 502)
  }

  const track = pickTrack(extractCaptionTracks(html), wanted)
  if (!track?.baseUrl) return miss('no_captions')

  // exp=xpe 就是 PO token 名單的標記，抓了也只會拿到空的，省一次請求
  if (track.baseUrl.includes('exp=xpe')) return miss('po_token')

  let raw: string
  try {
    const res = await fetch(`${track.baseUrl}&fmt=json3`, { headers: browserish })
    if (!res.ok) return miss('blocked', 502)
    raw = await res.text()
  } catch {
    return miss('unreachable', 502)
  }
  if (!raw.trim()) return miss('po_token')

  const text = json3ToPanelText(raw).slice(0, 20000)
  if (!text) return miss('empty')

  return { ok: true, text, lang: track.languageCode ?? '', auto: track.kind === 'asr' }
}

// ─────────────────────────────────────────────────────────────
// 文章抓取：把一個網址變成可讀的本文
//
// 跟 /api/transcript 不同，這條路的命中率應該高得多——新聞網站不像
// YouTube 會擋機房 IP。抓不到的典型原因是付費牆與整頁靠 JS 才渲染，
// 兩種都會抽出一篇很短的東西，所以用長度當判準，然後退回請使用者貼。
//
// 抓回來的東西會先給使用者看過才生成教材（跟歌詞、逐字稿同一條規矩）。
// ─────────────────────────────────────────────────────────────

/** 只放行公開網站。擋掉內網與非 http(s)，不要讓這支變成打內部服務的跳板 */
function isFetchableUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return null
  // IPv4 私有位址與 loopback；IPv6 一律擋（公開新聞網站不會只有 IPv6 字面位址）
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) {
      return null
    }
    if (a === 169 && b === 254) return null // 雲端的 metadata 端點都在這段
  }
  if (host.includes(':')) return null

  return url
}

/** 一次最多讀多少 HTML。新聞頁 200KB 綽綽有餘，再大多半是塞滿廣告的入口頁 */
const ARTICLE_HTML_LIMIT = 600_000

async function handleArticle(request: Request, env: Env, origin: string): Promise<Response> {
  if (!hasAccess(request, env)) return accessDeniedResponse(origin)

  let body: { url?: string }
  try {
    body = (await request.json()) as { url?: string }
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, origin)
  }

  const target = isFetchableUrl((body.url ?? '').trim())
  if (!target) {
    return jsonResponse({ error: 'bad_url', reason: 'bad_url' }, 400, origin)
  }

  const cache = caches.default
  const cacheRequest = new Request(`https://article-cache.local/${fnv1a(target.href)}-${target.href.length}`, {
    method: 'GET',
  })
  const cached = await cache.match(cacheRequest)
  if (cached) {
    return new Response(cached.body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-article-cache': 'hit',
        ...corsHeaders(origin),
      },
    })
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (isRateLimited(ip, 'article', 20)) {
    return jsonResponse({ error: 'rate_limited', message: '查詢太頻繁，請一分鐘後再試' }, 429, origin)
  }

  let html: string
  try {
    const res = await fetch(target.href, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    })
    if (!res.ok) {
      return jsonResponse(
        { error: 'article_failed', reason: res.status === 403 || res.status === 401 ? 'blocked' : 'failed' },
        404,
        origin,
      )
    }
    const type = res.headers.get('content-type') ?? ''
    if (!type.includes('html')) {
      return jsonResponse({ error: 'article_failed', reason: 'not_html' }, 404, origin)
    }
    html = (await res.text()).slice(0, ARTICLE_HTML_LIMIT)
  } catch {
    return jsonResponse({ error: 'article_failed', reason: 'unreachable' }, 502, origin)
  }

  const { title, text } = extractArticle(html)
  // 太短＝多半是付費牆，或整頁要跑 JS 才有內容。這兩種都救不了，直接說實話
  if (text.length < 200) {
    return jsonResponse({ error: 'article_failed', reason: 'too_short', title }, 404, origin)
  }

  const payload = JSON.stringify({ title, text: text.slice(0, 20000) })
  await cache.put(
    cacheRequest,
    new Response(payload, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'max-age=604800' },
    }),
  )
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
  })
}

// ─────────────────────────────────────────────────────────────
// 文章推薦的素材池：各語言幾個新聞網站自己發佈的 RSS
//
// 這份清單**在這個開發環境裡驗證不到**（容器的網路代理擋掉了所有新聞網站），
// 用的是長年穩定的公開網址。所以設計成：每個來源各自成敗，回傳時附上
// 哪些抓得到、哪些抓不到，畫面會照實顯示。某個網址失效時改這裡、
// wrangler deploy 一次就好，前端不用動。
//
// 挑來源的原則：每個語言都放「難度不同」的幾家，讓 AI 有得挑——
// 全放硬新聞的話，B1 的人永遠只會被推薦到最難的那種。
// ─────────────────────────────────────────────────────────────

const FEEDS: Record<string, Array<{ name: string; url: string }>> = {
  英文: [
    { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
    { name: 'BBC Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
    { name: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml' },
    { name: 'The Guardian Life & Style', url: 'https://www.theguardian.com/lifeandstyle/rss' },
  ],
  日文: [
    { name: 'NHK 主要ニュース', url: 'https://www3.nhk.or.jp/rss/news/cat0.xml' },
    { name: 'NHK 科学・文化', url: 'https://www3.nhk.or.jp/rss/news/cat3.xml' },
    { name: 'BBC ニュース日本語', url: 'https://feeds.bbci.co.uk/japanese/rss.xml' },
  ],
  韓文: [
    { name: 'BBC 코리아', url: 'https://feeds.bbci.co.uk/korean/rss.xml' },
    { name: '한겨레', url: 'https://www.hani.co.kr/rss/' },
    { name: '경향신문', url: 'https://www.khan.co.kr/rss/rssdata/total_news.xml' },
  ],
}

/** 一次送進 prompt 的條目上限。四家各十則左右，挑得出東西又不會吃太多 token */
const FEED_ITEM_LIMIT = 36

async function fetchOneFeed(url: string): Promise<FeedItem[] | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'LG-family-language-app (https://github.com/happyvqq-tech/LG)',
        accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
      // 一家慢不能拖垮整個推薦。Workers 沒有 fetch 逾時參數，用 AbortSignal
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const items = parseFeed((await res.text()).slice(0, 800_000))
    return items.length > 0 ? items : null
  } catch {
    return null
  }
}

async function handleFeeds(request: Request, env: Env, origin: string): Promise<Response> {
  if (!hasAccess(request, env)) return accessDeniedResponse(origin)

  let body: { language?: string }
  try {
    body = (await request.json()) as { language?: string }
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, origin)
  }

  const feeds = FEEDS[body.language ?? '']
  if (!feeds) return jsonResponse({ error: 'unsupported_language' }, 400, origin)

  // 新聞會更新，但不需要每按一次就重抓——半小時內同一個語言共用一份
  const cache = caches.default
  const cacheRequest = new Request(`https://feeds-cache.local/${encodeURIComponent(body.language ?? '')}`, {
    method: 'GET',
  })
  const cached = await cache.match(cacheRequest)
  if (cached) {
    return new Response(cached.body, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-feeds-cache': 'hit', ...corsHeaders(origin) },
    })
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (isRateLimited(ip, 'feeds', 10)) {
    return jsonResponse({ error: 'rate_limited', message: '查詢太頻繁，請一分鐘後再試' }, 429, origin)
  }

  const results = await Promise.all(feeds.map((f) => fetchOneFeed(f.url)))
  const sources = feeds.map((f, i) => ({ name: f.name, ok: results[i] !== null }))
  const items = mergeFeeds(
    feeds.map((f, i) => ({ source: f.name, items: results[i] ?? [] })),
    FEED_ITEM_LIMIT,
  )

  // 全部失敗就不要快取：多半是一時連不上，快取等於把壞運氣延長半小時
  if (items.length === 0) {
    return jsonResponse({ error: 'feeds_unavailable', sources }, 502, origin)
  }

  const payload = JSON.stringify({ items, sources })
  await cache.put(
    cacheRequest,
    new Response(payload, {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'max-age=1800' },
    }),
  )
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
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
            // Google 語音沒設不會壞掉，前端會自動退回瀏覽器內建語音
            google_tts_key: env.GOOGLE_TTS_API_KEY
              ? `已設定（${env.GOOGLE_TTS_API_KEY.length} 字元）`
              : '（未設定，英日韓會使用瀏覽器內建語音）',
            // 通關密碼是選配的，沒設就代表任何人拿到網址都能直接用
            access_passphrase: env.ACCESS_PASSPHRASE ? '已設定（有通關密碼保護）' : '（未設定，任何人都能直接使用）',
            // 歌曲模組找原曲影片用；沒設只是要自己貼一次 YouTube 連結
            youtube_key: env.YOUTUBE_API_KEY
              ? `已設定（${env.YOUTUBE_API_KEY.length} 字元）`
              : '（未設定，歌曲模組會請你自己貼 YouTube 連結）',
            // 影片逐字稿的 AI 聽寫；沒設只是抓不到字幕時要自己貼
            gemini_key: env.GEMINI_API_KEY
              ? `已設定（${env.GEMINI_API_KEY.length} 字元）`
              : '（未設定，影片字幕抓不到時要自己貼）',
          },
          null,
          2,
        ),
        { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' } },
      )
    }

    if (!origin || !isAllowedOrigin(origin, env)) {
      return new Response(JSON.stringify({ error: 'origin_not_allowed' }), {
        status: 403,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) })
    }

    if (url.pathname === '/api/tts' && request.method === 'POST') {
      return handleTts(request, env, origin)
    }

    if (url.pathname === '/api/gtts' && request.method === 'POST') {
      return handleGtts(request, env, origin)
    }

    // 用 POST 而不是 GET：現有的 CORS 設定只放行 POST/OPTIONS，
    // 為了一支唯讀端點去放寬 Access-Control-Allow-Methods 不划算
    if (url.pathname === '/api/gtts/voices' && request.method === 'POST') {
      return handleGoogleVoices(request, env, origin)
    }

    if (url.pathname === '/api/lyrics' && request.method === 'POST') {
      return handleLyrics(request, env, origin)
    }

    if (url.pathname === '/api/youtube' && request.method === 'POST') {
      return handleYouTube(request, env, origin)
    }

    if (url.pathname === '/api/video-check' && request.method === 'POST') {
      return handleVideoCheck(request, env, origin)
    }

    if (url.pathname === '/api/transcript' && request.method === 'POST') {
      return handleTranscript(request, env, origin)
    }

    if (url.pathname === '/api/article' && request.method === 'POST') {
      return handleArticle(request, env, origin)
    }

    if (url.pathname === '/api/feeds' && request.method === 'POST') {
      return handleFeeds(request, env, origin)
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

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return jsonResponse({ error: 'missing_fields', message: '需要 messages' }, 400, origin)
    }

    let model: string
    let system: string | undefined
    let maxTokens: number
    /** 這個模型必須附帶的欄位（新一代要明確關掉思考，見 prompts/index.ts 的 requestOptionsFor） */
    let options: ModelRequestOptions = { body: {}, betas: [] }

    if (body.prompt) {
      if (!isPromptModule(body.prompt.module)) {
        return jsonResponse(
          { error: 'unknown_prompt_module', message: `不認得的 prompt 模組：${String(body.prompt.module)}` },
          400,
          origin,
        )
      }
      const resolved = resolvePrompt(body.prompt.module, body.prompt.vars)
      model = resolved.model
      system = resolved.system
      options = resolved.options
      // 前端可以往下調（例如省 token），但不能往上超過模組的預設上限
      maxTokens = Math.min(body.max_tokens ?? resolved.maxTokens, resolved.maxTokens)
    } else {
      // 舊版路徑（見 ChatRequestBody 的說明）
      if (!body.model || !body.max_tokens) {
        return jsonResponse(
          { error: 'missing_fields', message: '需要 prompt.module，或舊版的 model / max_tokens' },
          400,
          origin,
        )
      }
      model = body.model
      system = body.system
      maxTokens = body.max_tokens
    }

    const upstream = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        ...(options.betas.length > 0 ? { 'anthropic-beta': options.betas.join(',') } : {}),
      },
      body: JSON.stringify({
        ...options.body,
        model,
        system,
        messages: body.messages,
        max_tokens: maxTokens,
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

    // 診斷：403 跟 401 一樣值得附加資訊。官方定義是 permission_error——
    // 這組憑證的組織／workspace 不被允許，或被區域限制、身分驗證擋下，
    // 而且明確標示不可重試。附上 key 前綴讓人確認是哪一把，
    // 並講清楚「組織用不了的模型通常是 404 而不是 403」，省得往模型方向查錯邊
    if (upstream.status === 403) {
      return jsonResponse(
        {
          error: 'anthropic_permission_denied',
          message:
            `Anthropic 回傳 403（permission_error）。key 前綴 "${env.ANTHROPIC_API_KEY.slice(0, 7)}…"。` +
            '這是帳號層級的權限問題，不是模型或這支程式的問題（模型不可用通常回 404）。' +
            '請到 console.anthropic.com 檢查：額度與付款、金鑰是否被停用、' +
            '組織有沒有待完成的身分驗證，以及是否有區域限制。',
          upstream: text.slice(0, 500),
        },
        403,
        origin,
      )
    }

    return new Response(text, {
      status: upstream.status,
      headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(origin) },
    })
  },
}
