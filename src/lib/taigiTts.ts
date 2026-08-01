// 台語語音播放：透過 Worker 呼叫雅婷 TTS，取回 mp3 後用 <audio> 播。
//
// 為什麼不能沿用 speech.ts：那支走的是瀏覽器 speechSynthesis，而瀏覽器
// 沒有台語語音，硬用 zh-TW 會被唸成國語（見 speech.ts 的 LANG_CODE 註解）。
//
// 每一次合成都會花雅婷的點數，所以這裡做兩層快取：
//   1. 分頁內的 blob URL 快取（同一句反覆聽、跟讀重播完全不再連網）
//   2. Worker 端的 Cloudflare Cache（跨裝置、跨分頁共用）
// 兩層都以「句子＋音色＋語速」為鍵。

import { clampTaigiSpeed, DEFAULT_TAIGI_VOICE, type TaigiVoiceId } from './taigiVoice'
import { clearAccessPassphrase, loadAccessPassphrase } from './accessGate'

/** 要跟 claude.ts 及 worker/src/index.ts 的 ACCESS_HEADER 一致 */
const ACCESS_HEADER = 'x-lgl-access'

export class TaigiTtsError extends Error {
  /** 給使用者看的白話訊息，技術細節留在 message */
  friendlyMessage: string
  constructor(message: string, friendlyMessage: string) {
    super(message)
    this.name = 'TaigiTtsError'
    this.friendlyMessage = friendlyMessage
  }
}

/** 分頁內的音檔快取：key → blob URL。分頁關掉就沒了，不必自己清。 */
const blobCache = new Map<string, string>()
/** 同一句同時被要求兩次（預先載入 + 使用者搶快按播放）時共用同一個請求 */
const inflight = new Map<string, Promise<string>>()

function cacheKey(text: string, voice: TaigiVoiceId, speed: number): string {
  return `${voice}|${speed}|${text}`
}

async function fetchAudioUrl(text: string, voice: TaigiVoiceId, speed: number): Promise<string> {
  const workerUrl = import.meta.env.VITE_WORKER_URL
  if (!workerUrl) {
    throw new TaigiTtsError('缺少 VITE_WORKER_URL，請依 .env.example 建立 .env', '台語語音服務目前無法使用')
  }

  const passphrase = loadAccessPassphrase()
  let res: Response
  try {
    res = await fetch(`${workerUrl.replace(/\/$/, '')}/api/tts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(passphrase ? { [ACCESS_HEADER]: passphrase } : {}),
      },
      body: JSON.stringify({ text, model: voice, speed }),
    })
  } catch {
    throw new TaigiTtsError('fetch /api/tts 失敗', '無法連線到語音服務，請檢查網路後重試')
  }

  if (!res.ok) {
    let detail = ''
    let errorCode = ''
    try {
      const j = (await res.json()) as { message?: string; error?: string }
      detail = j.message ?? j.error ?? ''
      errorCode = j.error ?? ''
    } catch {
      // 非 JSON 錯誤內容，只回報狀態碼
    }
    if (res.status === 401 && errorCode === 'access_denied') {
      clearAccessPassphrase()
      window.location.reload()
      throw new TaigiTtsError('access denied', '通關密碼已變更，請重新輸入')
    }
    if (res.status === 429) {
      throw new TaigiTtsError('tts rate limited', '語音請求太頻繁，請一分鐘後再試')
    }
    throw new TaigiTtsError(
      `TTS ${res.status}${detail ? '：' + detail : ''}`,
      res.status === 500 || res.status === 502
        ? '台語語音服務暫時無法使用（可能是金鑰未設定或點數用完）'
        : '台語語音合成失敗，請稍後再試',
    )
  }

  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

/** 取得（必要時才合成）一句台語的音檔網址 */
export async function getTaigiAudioUrl(
  text: string,
  voice: TaigiVoiceId = DEFAULT_TAIGI_VOICE,
  rate = 1,
): Promise<string> {
  const speed = clampTaigiSpeed(rate)
  const key = cacheKey(text, voice, speed)
  const cached = blobCache.get(key)
  if (cached) return cached

  const pending = inflight.get(key)
  if (pending) return pending

  const req = fetchAudioUrl(text, voice, speed)
    .then((url) => {
      blobCache.set(key, url)
      return url
    })
    .finally(() => {
      inflight.delete(key)
    })
  inflight.set(key, req)
  return req
}

/**
 * 背景先把後面幾句合成好，換句時就不用等。
 * 失敗完全靜音處理——這只是先跑一步，真正播放時還會再要一次並顯示錯誤。
 */
export function preloadTaigi(texts: string[], voice: TaigiVoiceId, rate = 1): void {
  for (const t of texts) {
    if (!t.trim()) continue
    void getTaigiAudioUrl(t, voice, rate).catch(() => undefined)
  }
}

let current: HTMLAudioElement | null = null

export function stopTaigi(): void {
  if (!current) return
  current.pause()
  current.onended = null
  current.onerror = null
  current = null
}

/**
 * 播一句台語，Promise 於播完時 resolve。
 * 被 stopTaigi() 或下一次 playTaigi() 中斷時也 resolve
 * （語意跟 speech.ts 的 speak() 一致，呼叫端不必分兩種收尾）。
 */
export async function playTaigi(
  text: string,
  voice: TaigiVoiceId = DEFAULT_TAIGI_VOICE,
  rate = 1,
): Promise<void> {
  const url = await getTaigiAudioUrl(text, voice, rate)
  stopTaigi()
  const audio = new Audio(url)
  current = audio
  return new Promise((resolve, reject) => {
    audio.onended = () => {
      if (current === audio) current = null
      resolve()
    }
    audio.onerror = () => {
      if (current !== audio) {
        // 已經被下一次播放接手，這個 error 是 pause 造成的，不是真的失敗
        resolve()
        return
      }
      current = null
      reject(new TaigiTtsError('audio element error', '音檔播放失敗，請再試一次'))
    }
    audio.play().catch(() => {
      // iOS 未經使用者手勢不准播放；這裡不當成錯誤中斷整個流程
      if (current === audio) current = null
      resolve()
    })
  })
}

/**
 * 播放並回報實際長度（毫秒），跟讀評分要用來比節奏。
 * 從 audio.duration 讀而不是量 wall clock，比較不受載入延遲影響。
 */
export async function playTaigiTimed(
  text: string,
  voice: TaigiVoiceId,
  rate: number,
): Promise<{ durationMs: number; url: string }> {
  const url = await getTaigiAudioUrl(text, voice, rate)
  stopTaigi()
  const audio = new Audio(url)
  current = audio
  return new Promise((resolve, reject) => {
    const finish = () => {
      const durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0
      if (current === audio) current = null
      resolve({ durationMs, url })
    }
    audio.onended = finish
    audio.onerror = () => {
      if (current !== audio) {
        finish()
        return
      }
      current = null
      reject(new TaigiTtsError('audio element error', '音檔播放失敗，請再試一次'))
    }
    audio.play().catch(() => finish())
  })
}
