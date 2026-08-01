// 語音封裝：TTS 與 STT（SpeechRecognition）
//
// TTS 有兩條路，全站所有播放都走這裡，呼叫端不必知道差別：
//   1. Google Cloud TTS（英日韓）——音質高且各裝置一致，是預設路線
//   2. 瀏覽器 speechSynthesis——古文、台語佔位，以及 Google 不可用時的退路
//
// 「Google 不可用」包含：功能開關關閉、沒設 VITE_WORKER_URL、Worker 沒有金鑰、
// 沒網路、額度用完、iOS 擋下自動播放。任何一種情況都會安靜地退回瀏覽器語音，
// 不會讓使用者看到錯誤，也不會讓頁面卡住。

import { isTaskLanguage, type Language } from './types'
import { filterByLang, sortByQuality, type VoiceLike } from './voiceScore'
import { loadVoiceChoice } from './voicePref'
import {
  googleTtsAvailable,
  pickGoogleVoice,
  playGoogleSequence,
  playGoogleTimed,
  stopGoogle,
  unlockGoogleAudio,
} from './googleTts'

export const LANG_CODE: Record<Language, string> = {
  英文: 'en-US',
  日文: 'ja-JP',
  韓文: 'ko-KR',
  // 瀏覽器沒有台語（閩南語）語音，這裡的 zh-TW 是國語，只是不讓程式爆掉的
  // 佔位值——台語模組尚未實作，實作時要另外處理發音來源（見 CLAUDE.md 第 10 節）
  台語: 'zh-TW',
  古文: 'zh-TW', // 文言誦讀：用國語語音，重點在停頓與節奏
}

// ---------------- TTS ----------------

/** 這台瀏覽器有沒有 speechSynthesis（Google 路線不需要它） */
function browserTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

/**
 * 這個頁面到底有沒有辦法發出聲音——UI 的「不支援語音播放」警告以此為準。
 * 只要 Google 那條路可能通，就算瀏覽器沒有 speechSynthesis 也還是有聲音。
 */
export function ttsSupported(): boolean {
  return browserTtsSupported() || googleTtsAvailable()
}

let voicesCache: SpeechSynthesisVoice[] = []
// 有些裝置 getVoices() 永遠回傳空陣列。沒有這個旗標的話，每次播放都會重新
// 等滿 1.5 秒的 fallback，全站語音功能都會被拖慢（見稽核報告 P2-3）。
let voicesLoadAttempted = false

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!ttsSupported()) return Promise.resolve([])
  const current = window.speechSynthesis.getVoices()
  if (current.length > 0) {
    voicesCache = current
    return Promise.resolve(current)
  }
  // 已經等過一次還是沒有 voice，就不要每次播放都重等——下面掛著的
  // voiceschanged 監聽器不會被移除，真的之後有 voice 到位還是會補上 voicesCache
  if (voicesLoadAttempted) return Promise.resolve([])
  // iOS/Android 首次呼叫常回空陣列，需等 voiceschanged
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      voicesLoadAttempted = true
      resolve(window.speechSynthesis.getVoices())
    }, 1500)
    window.speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        clearTimeout(timer)
        voicesLoadAttempted = true
        voicesCache = window.speechSynthesis.getVoices()
        resolve(voicesCache)
      },
      { once: true },
    )
  })
}

/** 這個語言在這台裝置上可用的語音，已依自然度排序（最自然的在最前面） */
export async function listVoices(lang: Language): Promise<SpeechSynthesisVoice[]> {
  const voices = voicesCache.length > 0 ? voicesCache : await loadVoices()
  return sortByQuality(filterByLang(voices as VoiceLike[], LANG_CODE[lang]), LANG_CODE[lang]) as SpeechSynthesisVoice[]
}

/**
 * 挑語音：使用者手動指定過就用他選的，否則用 voiceScore 的評分自動挑最自然的。
 * 評分邏輯與「哪些語音該避開」見 voiceScore.ts。
 */
export async function pickVoice(lang: Language): Promise<SpeechSynthesisVoice | null> {
  const sorted = await listVoices(lang)
  if (sorted.length === 0) return null

  const choice = loadVoiceChoice(lang)
  // 使用者挑的是 Google 音色時，這裡不該拿它去比對裝置語音——那一定找不到，
  // 而走到這個函式就代表 Google 那條路已經不通，改用自動挑選的裝置語音
  if (choice?.kind === 'device') {
    // 使用者選的語音可能已被系統移除（例如刪掉下載的語音包），找不到就回頭自動挑
    const chosen = sorted.find((v) => v.voiceURI === choice.voiceURI)
    if (chosen) return chosen
  }
  return sorted[0]
}

export function stopSpeaking(): void {
  // 兩條路都要停：使用者按暫停時不知道現在這句是哪個引擎在唸
  stopGoogle()
  if (browserTtsSupported()) window.speechSynthesis.cancel()
}

/**
 * 決定這次要用的 Google 音色；回 null 代表這句話該走瀏覽器語音。
 *
 * 只有英日韓走 Google（CLAUDE.md 第 2 節）：古文用國語語音誦讀、
 * 台語有自己的雅婷路線，兩者都不該打到這裡。
 */
async function googleVoiceFor(lang: Language): Promise<string | null> {
  if (!googleTtsAvailable() || !isTaskLanguage(lang)) return null
  const choice = loadVoiceChoice(lang)
  // 使用者明確挑了這台裝置上的語音，就尊重他的選擇，不要硬塞雲端語音
  if (choice?.kind === 'device') return null
  return pickGoogleVoice(lang, choice?.kind === 'google' ? choice.name : null)
}

/**
 * 唸出一段文字，Promise 於播放結束時 resolve。
 * 被 cancel/interrupt 時也 resolve（由呼叫端的 session 機制決定是否繼續）。
 */
export async function speak(text: string, lang: Language, rate = 1): Promise<void> {
  await speakMeasured(text, lang, rate)
}

/**
 * 唸出一段文字，並回報「實際發聲」的毫秒數（跟讀評分要用來比節奏）。
 *
 * 兩條路都刻意排除抓檔、挑語音、排隊的時間——那些跟「這句話唸多久」無關，
 * 混進去會讓 prosodyScore 的 timing 訊號變成在量網路速度。被中斷時回 0，
 * 呼叫端要當成「沒有這個訊號」而不是「唸了 0 毫秒」。
 */
export async function speakMeasured(text: string, lang: Language, rate = 1): Promise<number> {
  // 必須在第一個 await 之前同步呼叫：iOS 只認使用者手勢當下的那個 task（見 googleTts.ts）
  unlockGoogleAudio()

  const googleVoice = await googleVoiceFor(lang)
  if (googleVoice) {
    try {
      return await playGoogleTimed(text, googleVoice, rate)
    } catch {
      // 退回瀏覽器語音。不把錯誤丟給使用者——他要的是聽到聲音，
      // 不是知道雲端語音掛了；連續失敗會由 googleTts 那邊自動停用整個 session
    }
  }
  return speakBrowser(text, lang, rate)
}

/** 瀏覽器 speechSynthesis 路線，回傳從 onstart 到 onend 的毫秒數 */
async function speakBrowser(text: string, lang: Language, rate: number): Promise<number> {
  if (!browserTtsSupported()) throw new Error('此瀏覽器不支援語音播放，請改用 Chrome 或 Edge')
  stopSpeaking()
  const utter = new SpeechSynthesisUtterance(text)
  utter.lang = LANG_CODE[lang]
  const voice = await pickVoice(lang)
  if (voice) utter.voice = voice
  utter.rate = rate
  return new Promise((resolve, reject) => {
    // speechSynthesis 沒有「這段音多長」可問，只能量 wall clock；
    // 但從 onstart 起算至少排除了佇列等待，比從呼叫端起算準得多
    let startedAt = 0
    utter.onstart = () => {
      startedAt = performance.now()
    }
    utter.onend = () => resolve(startedAt > 0 ? performance.now() - startedAt : 0)
    utter.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') resolve(0)
      else reject(new Error(`語音播放失敗：${e.error}`))
    }
    window.speechSynthesis.speak(utter)
  })
}

/**
 * 連續唸出多句，句與句之間沒有空隙。
 *
 * 為什麼不用 for 迴圈一句一句 await speak()：那樣每句都要等上一句的 onend
 * 回到 JS、再重新 pickVoice、再 speak，句子之間會有明顯停頓，整段聽起來
 * 一頓一頓的。改成一次把所有句子排進 speechSynthesis 的佇列，由瀏覽器自己
 * 接續播放，語氣和節奏都連得起來。
 *
 * onIndex 在每句真正開始發聲時回報索引，畫面才能同步顯示播到第幾句。
 * 被 stopSpeaking() 中斷時直接 resolve（由呼叫端的 session 機制決定後續）。
 */
export async function speakSequence(
  texts: string[],
  lang: Language,
  rate = 1,
  onIndex?: (index: number) => void,
): Promise<void> {
  if (texts.length === 0) return
  unlockGoogleAudio() // 同 speak()，必須在第一個 await 之前

  const googleVoice = await googleVoiceFor(lang)
  if (googleVoice) {
    try {
      await playGoogleSequence(texts, googleVoice, rate, onIndex)
      return
    } catch {
      // 同 speak()：安靜退回瀏覽器語音
    }
  }

  if (!browserTtsSupported()) throw new Error('此瀏覽器不支援語音播放，請改用 Chrome 或 Edge')
  stopSpeaking()

  const voice = await pickVoice(lang)
  const code = LANG_CODE[lang]

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (err?: Error) => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else resolve()
    }

    texts.forEach((text, i) => {
      const utter = new SpeechSynthesisUtterance(text)
      utter.lang = code
      if (voice) utter.voice = voice
      utter.rate = rate
      utter.onstart = () => onIndex?.(i)
      utter.onerror = (e) => {
        // 中途被 cancel 掉是正常操作（換速度、離開頁面），不是錯誤
        if (e.error === 'canceled' || e.error === 'interrupted') finish()
        else finish(new Error(`語音播放失敗：${e.error}`))
      }
      if (i === texts.length - 1) utter.onend = () => finish()
      window.speechSynthesis.speak(utter)
    })
  })
}

/** 依句號等標點切分句子（分句播放用） */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?。！？])\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// ---------------- STT ----------------

interface SpeechRecognitionResultLike {
  transcript: string
  confidence?: number
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((event: { results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function sttSupported(): boolean {
  return typeof window !== 'undefined' && getRecognitionCtor() !== null
}

/**
 * 按住說話式的語音辨識：start() 開始、stop() 結束並取得逐字稿。
 * 不支援的瀏覽器請改用鍵盤輸入（CLAUDE.md 第 8 節降級方案）。
 */
export class HoldToTalkRecognizer {
  private recognition: SpeechRecognitionLike | null = null
  private transcript = ''
  private finishResolve: ((text: string) => void) | null = null
  private finishReject: ((err: Error) => void) | null = null
  /**
   * 最近一次 onresult 事件裡，各段辨識結果信心值的平均（0~1）。
   * 多數瀏覽器（含大部分 Android Chrome）不回傳這個值時恆為 0——呼叫端
   * 遇到 0 應視為「沒有這個訊號」，不要當成「唸得很爛」。
   */
  lastConfidence = 0

  start(lang: Language): void {
    const Ctor = getRecognitionCtor()
    if (!Ctor) throw new Error('此瀏覽器不支援語音辨識，請改用鍵盤輸入')
    this.transcript = ''
    this.lastConfidence = 0
    const rec = new Ctor()
    rec.lang = LANG_CODE[lang]
    rec.interimResults = true
    rec.continuous = true
    rec.onresult = (event) => {
      let text = ''
      let confSum = 0
      let confCount = 0
      for (let i = 0; i < event.results.length; i++) {
        const alt = event.results[i][0]
        text += alt?.transcript ?? ''
        if (typeof alt?.confidence === 'number' && alt.confidence > 0) {
          confSum += alt.confidence
          confCount++
        }
      }
      this.transcript = text
      if (confCount > 0) this.lastConfidence = confSum / confCount
    }
    rec.onerror = (event) => {
      // no-speech 不算失敗，只是沒聽到內容
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        const msg =
          event.error === 'not-allowed'
            ? '麥克風權限被拒絕，請到瀏覽器設定開啟，或改用鍵盤輸入'
            : `語音辨識失敗：${event.error}`
        this.finishReject?.(new Error(msg))
        this.finishReject = null
        this.finishResolve = null
      }
    }
    rec.onend = () => {
      this.finishResolve?.(this.transcript.trim())
      this.finishResolve = null
      this.finishReject = null
    }
    this.recognition = rec
    rec.start()
  }

  /** 放開按鈕：結束辨識並回傳逐字稿 */
  stop(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.recognition) {
        resolve('')
        return
      }
      this.finishResolve = resolve
      this.finishReject = reject
      this.recognition.stop()
      this.recognition = null
    })
  }

  cancel(): void {
    this.recognition?.abort()
    this.recognition = null
    this.finishResolve = null
    this.finishReject = null
  }
}
