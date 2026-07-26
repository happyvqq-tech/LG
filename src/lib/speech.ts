// 瀏覽器語音封裝：TTS（speechSynthesis）與 STT（SpeechRecognition）
// 第一階段不串任何付費語音 API（CLAUDE.md 第 2 節）

import type { Language } from './types'
import { filterByLang, sortByQuality, type VoiceLike } from './voiceScore'
import { loadVoicePref } from './voicePref'

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

  const preferredURI = loadVoicePref(lang)
  if (preferredURI) {
    // 使用者選的語音可能已被系統移除（例如刪掉下載的語音包），找不到就回頭自動挑
    const chosen = sorted.find((v) => v.voiceURI === preferredURI)
    if (chosen) return chosen
  }
  return sorted[0]
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
  utter.lang = LANG_CODE[lang]
  const voice = await pickVoice(lang)
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
  if (!ttsSupported()) throw new Error('此瀏覽器不支援語音播放，請改用 Chrome 或 Edge')
  if (texts.length === 0) return
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
