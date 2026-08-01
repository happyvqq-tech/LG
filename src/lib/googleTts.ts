// 英日韓語音播放：透過 Worker 呼叫 Google Cloud TTS，取回 mp3 後用 <audio> 播。
//
// 為什麼不直接用瀏覽器 speechSynthesis：同一句話在不同手機上聽起來差很多，
// 品質完全取決於使用者裝了哪些語音包（voiceScore.ts 那 80 行就是在猜這件事）。
// 主要使用裝置是手機／平板，而 iOS 內建的壓縮語音正是最機械的一批。
// 改走 Google 之後音質變成可預測的，全家聽到的是同一個聲音。
//
// 成本控制（Google 每月前 100 萬字元免費，家庭用量約 12 萬）：
//   1. 一律用 1.0 倍速合成，語速交給 audio.playbackRate —— 同一句只會有一份音檔，
//      不會因為 SpeedPicker 的 5 檔速度而變成 5 份
//   2. 分頁內的 blob 快取（同一句重播完全不再連網）
//   3. Worker 端的 Cloudflare Cache（跨裝置、跨分頁共用）
//
// 任何一步失敗都會丟出錯誤，由 speech.ts 接住並退回瀏覽器語音——
// 沒有金鑰、沒有網路、額度用完的情況下 App 都還是能用，只是聲音沒那麼自然。

import { GOOGLE_TTS_ENABLED } from './features'
import {
  GOOGLE_LANG_QUERY,
  GOOGLE_PRIMARY_LOCALE,
  isSelectableVoice,
  rankGoogleVoices,
  type GoogleVoice,
} from './googleVoices'
import type { TaskLanguage } from './types'

export class GoogleTtsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleTtsError'
  }
}

function workerBase(): string | null {
  const url = import.meta.env.VITE_WORKER_URL
  return url ? url.replace(/\/$/, '') : null
}

/**
 * 連續失敗就整個 session 停用 Google，改用瀏覽器語音。
 *
 * 沒有這道保險的話，金鑰沒設或額度用完時，每一句都要先付一趟失敗的網路往返
 * 才 fallback，逐句聽會變得非常頓——而那正是最需要順暢的頁面。
 */
const FAILURE_LIMIT = 3
let consecutiveFailures = 0
let disabledForSession = false

/** 停用的原因，給 UI 顯示用（沒停用時為空字串） */
let disabledReason = ''

export function googleTtsDisabledReason(): string {
  return disabledReason
}

function noteFailure(message: string): void {
  consecutiveFailures++
  if (consecutiveFailures >= FAILURE_LIMIT) {
    disabledForSession = true
    disabledReason = message
  }
}

function noteSuccess(): void {
  consecutiveFailures = 0
}

/** 這個 session 還能不能用 Google 語音 */
export function googleTtsAvailable(): boolean {
  return GOOGLE_TTS_ENABLED && !disabledForSession && workerBase() !== null
}

// ---------------- iOS 播放解鎖 ----------------

/** preservesPitch 已經是標準屬性；webkitPreservesPitch 是舊版 Safari 的名字，型別庫裡沒有 */
interface PitchPreservingAudio extends HTMLAudioElement {
  webkitPreservesPitch?: boolean
}

let shared: PitchPreservingAudio | null = null

function sharedAudio(): PitchPreservingAudio {
  if (!shared) shared = new Audio() as PitchPreservingAudio
  return shared
}

let unlocked = false

/**
 * iOS Safari 要求 audio.play() 必須發生在使用者手勢的同一個 task 裡，
 * 但我們得先 await 網路把 mp3 抓回來，手勢那時已經過期了。
 *
 * 解法是全站共用同一個 <audio> 元素，並在使用者按下播放鍵的當下（await 之前）
 * 先對它呼叫一次 play()。這時候還沒有 src，play() 會 reject，但元素已經被
 * 標記成「使用者允許播放」，之後換 src 再播就不會被擋。
 *
 * 呼叫端務必在第一個 await 之前同步呼叫這支（見 speech.ts 的 speak()）。
 */
export function unlockGoogleAudio(): void {
  if (unlocked) return
  unlocked = true
  void sharedAudio()
    .play()
    .catch(() => undefined)
}

// ---------------- 語音清單 ----------------

const VOICES_TTL_MS = 7 * 24 * 60 * 60 * 1000
const voicesMemo = new Map<TaskLanguage, GoogleVoice[]>()
const voicesInflight = new Map<TaskLanguage, Promise<GoogleVoice[]>>()

function voicesStorageKey(lang: TaskLanguage): string {
  return `lgl.gvoices.${lang}`
}

function loadCachedVoices(lang: TaskLanguage): GoogleVoice[] | null {
  try {
    const raw = localStorage.getItem(voicesStorageKey(lang))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { t: number; v: GoogleVoice[] }
    if (!Array.isArray(parsed.v) || Date.now() - parsed.t > VOICES_TTL_MS) return null
    return parsed.v
  } catch {
    // localStorage 不可用或內容壞掉，當作沒有快取
    return null
  }
}

function saveCachedVoices(lang: TaskLanguage, voices: GoogleVoice[]): void {
  try {
    localStorage.setItem(voicesStorageKey(lang), JSON.stringify({ t: Date.now(), v: voices }))
  } catch {
    // 存不起來就只在本次 session 有效，不影響使用
  }
}

async function fetchVoices(languageCode: string): Promise<GoogleVoice[]> {
  const base = workerBase()
  if (!base) throw new GoogleTtsError('缺少 VITE_WORKER_URL')

  const res = await fetch(`${base}/api/gtts/voices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ languageCode }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      const j = (await res.json()) as { message?: string; error?: string }
      detail = j.message ?? j.error ?? ''
    } catch {
      // 非 JSON 錯誤內容，只回報狀態碼
    }
    throw new GoogleTtsError(`語音清單 ${res.status}${detail ? '：' + detail : ''}`)
  }
  const data = (await res.json()) as { voices?: GoogleVoice[] }
  return (data.voices ?? []).filter(isSelectableVoice)
}

/**
 * 這個語言可用的 Google 語音，已依自然度排序（最自然的在最前面）。
 * 失敗時回空陣列而不是丟錯——呼叫端（發音設定、自動挑選）都只要知道
 * 「有沒有可選的」，不需要為此中斷。
 */
export async function listGoogleVoices(lang: TaskLanguage): Promise<GoogleVoice[]> {
  if (!googleTtsAvailable()) return []

  const memo = voicesMemo.get(lang)
  if (memo) return memo

  const inflight = voicesInflight.get(lang)
  if (inflight) return inflight

  const primary = GOOGLE_PRIMARY_LOCALE[lang]
  const req = (async () => {
    const cached = loadCachedVoices(lang)
    if (cached && cached.length > 0) return rankGoogleVoices(cached, primary)

    try {
      // 先用兩碼（en）查，一次拿到 en-US／en-GB／en-AU… 各種口音；
      // 萬一上游不吃兩碼就退回主要口音，至少還有聲音可用
      let raw = await fetchVoices(GOOGLE_LANG_QUERY[lang])
      if (raw.length === 0) raw = await fetchVoices(primary)
      if (raw.length > 0) {
        saveCachedVoices(lang, raw)
        noteSuccess()
      }
      return rankGoogleVoices(raw, primary)
    } catch (e: unknown) {
      noteFailure((e as Error).message)
      return []
    }
  })().finally(() => {
    voicesInflight.delete(lang)
  })

  voicesInflight.set(lang, req)
  const result = await req
  if (result.length > 0) voicesMemo.set(lang, result)
  return result
}

/**
 * 決定這次要用哪個 Google 語音：使用者指定過就用他選的，
 * 否則用排序後的第一名。完全沒有可用語音時回 null（呼叫端改用瀏覽器語音）。
 */
export async function pickGoogleVoice(
  lang: TaskLanguage,
  preferredName: string | null,
): Promise<string | null> {
  const voices = await listGoogleVoices(lang)
  if (voices.length === 0) return null
  if (preferredName) {
    // 使用者選的音色可能已被 Google 下架，找不到就回頭自動挑
    const found = voices.find((v) => v.name === preferredName)
    if (found) return found.name
  }
  return voices[0].name
}

// ---------------- 音檔取得 ----------------

/** 分頁內的音檔快取：key → blob URL。分頁關掉就沒了，不必自己清。 */
const blobCache = new Map<string, string>()
/** 同一句同時被要求兩次（預先載入 + 使用者搶快按播放）時共用同一個請求 */
const audioInflight = new Map<string, Promise<string>>()

function audioKey(text: string, voice: string): string {
  return `${voice}|${text}`
}

async function fetchAudioUrl(text: string, voice: string): Promise<string> {
  const base = workerBase()
  if (!base) throw new GoogleTtsError('缺少 VITE_WORKER_URL，請依 .env.example 建立 .env')

  let res: Response
  try {
    res = await fetch(`${base}/api/gtts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, voice }),
    })
  } catch {
    throw new GoogleTtsError('無法連線到語音服務')
  }

  if (!res.ok) {
    let detail = ''
    try {
      const j = (await res.json()) as { message?: string; error?: string }
      detail = j.message ?? j.error ?? ''
    } catch {
      // 非 JSON 錯誤內容，只回報狀態碼
    }
    throw new GoogleTtsError(`TTS ${res.status}${detail ? '：' + detail : ''}`)
  }

  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

/** 取得（必要時才合成）一句話的音檔網址 */
export async function getGoogleAudioUrl(text: string, voice: string): Promise<string> {
  const key = audioKey(text, voice)
  const cached = blobCache.get(key)
  if (cached) return cached

  const pending = audioInflight.get(key)
  if (pending) return pending

  const req = fetchAudioUrl(text, voice)
    .then((url) => {
      blobCache.set(key, url)
      noteSuccess()
      return url
    })
    .catch((e: unknown) => {
      noteFailure((e as Error).message)
      throw e
    })
    .finally(() => {
      audioInflight.delete(key)
    })
  audioInflight.set(key, req)
  return req
}

/**
 * 背景先把後面幾句合成好，換句時就不用等。
 * 失敗完全靜音處理——這只是先跑一步，真正播放時還會再要一次並顯示錯誤。
 */
export function preloadGoogle(texts: string[], voice: string): void {
  for (const t of texts) {
    if (!t.trim()) continue
    void getGoogleAudioUrl(t, voice).catch(() => undefined)
  }
}

// ---------------- 播放 ----------------

/** 遞增的播放 session，用來判斷「這次播放是否已被後來的播放／停止取代」 */
let playToken = 0

/**
 * 中止目前這次播放用的收尾函式。
 *
 * 為什麼需要它：audio.pause() 不會觸發 ended 或 error 事件，只靠事件收尾的話，
 * 使用者一按暫停，playUrl 的 Promise 就永遠不會 settle，呼叫端的 playing 狀態
 * 會卡在 true（按鈕永遠停在「⏸」）。
 */
let currentAbort: (() => void) | null = null

export function stopGoogle(): void {
  playToken++
  const abort = currentAbort
  currentAbort = null
  shared?.pause()
  abort?.()
}

function applyRate(audio: PitchPreservingAudio, rate: number): void {
  audio.playbackRate = rate
  // 變速不變調。preservesPitch 是標準屬性，webkitPreservesPitch 是舊版 Safari 的名字；
  // 兩個都設，反正設到不存在的屬性沒有副作用
  audio.preservesPitch = true
  audio.webkitPreservesPitch = true
}

/**
 * 播放已經拿到的音檔，Promise 於播完（或被接手／停止）時 resolve，
 * 回傳實際發聲的毫秒數——跟讀評分要拿它跟使用者唸的時間比節奏。
 *
 * 從 audio.duration 換算而不是量 wall clock：後者會把抓檔、解碼、排隊的時間
 * 都算進去，那些跟「這句話唸多久」無關。被中斷時回 0（呼叫端當作沒有這個訊號）。
 */
function playUrl(url: string, rate: number, token: number): Promise<number> {
  const audio = sharedAudio()
  if (audio.src !== url) audio.src = url
  // 重播同一句時 src 沒變、currentTime 還停在結尾，不歸零的話 play() 會立刻結束
  audio.currentTime = 0
  applyRate(audio, rate)

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err?: GoogleTtsError) => {
      if (settled) return
      settled = true
      audio.onended = null
      audio.onerror = null
      if (currentAbort === abort) currentAbort = null
      if (err) reject(err)
      else resolve(0)
    }
    const abort = () => finish()
    currentAbort = abort

    const finishPlayed = () => {
      if (settled) return
      settled = true
      audio.onended = null
      audio.onerror = null
      if (currentAbort === abort) currentAbort = null
      // 播放速度會等比縮放實際耗時：1.25 倍速唸完只花 duration/1.25
      const ms = Number.isFinite(audio.duration) ? (audio.duration / rate) * 1000 : 0
      resolve(ms)
    }

    audio.onended = () => finishPlayed()
    audio.onerror = () => {
      // 已經被下一次播放接手，這個 error 是換 src 造成的，不是真的失敗
      if (playToken !== token) finish()
      else finish(new GoogleTtsError('音檔播放失敗'))
    }

    audio.play().catch(() => {
      if (playToken !== token) {
        finish()
        return
      }
      // iOS 未經使用者手勢不准播放。丟錯讓 speech.ts 退回 speechSynthesis，
      // 那邊的限制比較寬鬆，至少還聽得到聲音
      finish(new GoogleTtsError('瀏覽器擋下了自動播放'))
    })
  })
}

/**
 * 唸出一段文字，回傳實際發聲的毫秒數（被中斷時為 0）。
 * 被 stopGoogle() 或下一次播放中斷時直接 resolve，不算錯誤。
 */
export async function playGoogleTimed(text: string, voice: string, rate = 1): Promise<number> {
  const url = await getGoogleAudioUrl(text, voice)
  stopGoogle()
  const token = playToken
  return playUrl(url, rate, token)
}

/** 唸出一段文字，不在意長度時用這支 */
export async function playGoogle(text: string, voice: string, rate = 1): Promise<void> {
  await playGoogleTimed(text, voice, rate)
}

/**
 * 連續唸出多句，並在每句開始時回報索引。
 *
 * 第一句抓回來就開始播，其餘的在背景併行預抓——不等整段合成完，
 * 使用者按下「整段連續播放」之後的等待時間跟只播一句差不多。
 */
export async function playGoogleSequence(
  texts: string[],
  voice: string,
  rate = 1,
  onIndex?: (index: number) => void,
): Promise<void> {
  if (texts.length === 0) return
  const first = await getGoogleAudioUrl(texts[0], voice)
  preloadGoogle(texts.slice(1), voice)

  stopGoogle()
  const token = playToken

  onIndex?.(0)
  await playUrl(first, rate, token)

  for (let i = 1; i < texts.length; i++) {
    if (playToken !== token) return
    const url = await getGoogleAudioUrl(texts[i], voice)
    if (playToken !== token) return
    onIndex?.(i)
    await playUrl(url, rate, token)
  }
}
