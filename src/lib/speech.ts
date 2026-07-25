// 瀏覽器語音封裝：TTS（speechSynthesis）與 STT（SpeechRecognition）
// 第一階段不串任何付費語音 API（CLAUDE.md 第 2 節）

import type { Language } from './types'

export const LANG_CODE: Record<Language, string> = {
  英文: 'en-US',
  日文: 'ja-JP',
  台語: 'zh-TW', // 台語模組（第三階段）以人工音檔為主，TTS 僅作備援
  古文: 'zh-TW', // 文言誦讀：用國語語音，重點在停頓與節奏
}

// ---------------- TTS ----------------

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
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

/** 挑選自然度較高的 voice：Edge 線上聲音（Natural/Online）> Google > 其他 */
export async function pickVoice(langCode: string): Promise<SpeechSynthesisVoice | null> {
  const voices = voicesCache.length > 0 ? voicesCache : await loadVoices()
  const prefix = langCode.slice(0, 2).toLowerCase()
  const matches = voices.filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(prefix))
  if (matches.length === 0) return null
  const score = (v: SpeechSynthesisVoice): number => {
    let s = 0
    if (/natural|online/i.test(v.name)) s += 4
    else if (/google/i.test(v.name)) s += 2
    else if (/microsoft/i.test(v.name)) s += 1
    if (v.lang.replace('_', '-').toLowerCase() === langCode.toLowerCase()) s += 0.5
    return s
  }
  return [...matches].sort((a, b) => score(b) - score(a))[0]
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel()
}

/**
 * 唸出一段文字，Promise 於播放結束時 resolve。
 * 被 cancel/interrupt 時也 resolve（由呼叫端的 session 機制決定是否繼續）。
 */
export async function speak(text: string, lang: Language, rate = 1): Promise<void> {
  if (!ttsSupported()) throw new Error('此瀏覽器不支援語音播放，請改用 Chrome 或 Edge')
  stopSpeaking()
  const utter = new SpeechSynthesisUtterance(text)
  const code = LANG_CODE[lang]
  utter.lang = code
  const voice = await pickVoice(code)
  if (voice) utter.voice = voice
  utter.rate = rate
  return new Promise((resolve, reject) => {
    utter.onend = () => resolve()
    utter.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') resolve()
      else reject(new Error(`語音播放失敗：${e.error}`))
    }
    window.speechSynthesis.speak(utter)
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
