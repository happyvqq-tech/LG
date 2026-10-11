// 影片模組的輸入介面與回應驗證
//
// system prompt 本文在 worker/src/prompts/videoPicker.ts 與 videoLesson.ts。

import type { Level, TaskLanguage } from '../types'

// ---------------- 選片方向 ----------------

export interface VideoPickerInput {
  language: TaskLanguage
  level: Level
  topic: string
  interests?: string
}

export interface VideoPick {
  /** 直接可以貼進 YouTube 搜尋框的字串 */
  query: string
  label: string
  why: string
  caution: string
  minutes: string
}

export interface VideoPickerResult {
  picks: VideoPick[]
}

function isPick(v: unknown): v is VideoPick {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.query !== 'string' || o.query.trim() === '') return false
  if (typeof o.label !== 'string' || o.label.trim() === '') return false
  // caution 一定要有：prompt 明講「沒有缺點的素材不存在」，
  // 空的代表模型在敷衍，那筆的推薦理由也不會可信
  if (typeof o.why !== 'string' || o.why.trim() === '') return false
  if (typeof o.caution !== 'string' || o.caution.trim() === '') return false
  if (typeof o.minutes !== 'string') o.minutes = ''
  return true
}

export function isVideoPickerResult(v: unknown): v is VideoPickerResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.picks) || o.picks.length === 0) return false
  o.picks = o.picks.filter(isPick)
  return (o.picks as unknown[]).length > 0
}

// ---------------- 分段教材 ----------------

export interface VideoLessonInput {
  language: TaskLanguage
  level: Level
  title: string
  transcript: string
}

export interface VideoLine {
  text: string
  zh: string
  /** 這句用耳朵聽會不會跟字面差很多 */
  tricky: boolean
  /** tricky 為 true 時：實際聽起來像什麼 */
  heard: string
  note: string
}

export interface VideoReduction {
  written: string
  spoken: string
  note: string
}

export interface VideoFiller {
  word: string
  /** 它在做什麼：拖時間／轉折／緩和語氣／確認對方在聽 */
  role: string
}

export interface VideoLesson {
  gist: string
  accent: string
  lines: VideoLine[]
  reductions: VideoReduction[]
  fillers: VideoFiller[]
  chunks: Array<{ text: string; zh: string; usage: string }>
}

function isLine(v: unknown): v is VideoLine {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.text !== 'string' || o.text.trim() === '') return false
  // 缺欄位補空值，不要讓整支影片作廢——畫面那邊本來就會判斷有沒有內容
  if (typeof o.zh !== 'string') o.zh = ''
  if (typeof o.heard !== 'string') o.heard = ''
  if (typeof o.note !== 'string') o.note = ''
  // tricky 沒給就當成「不特別」。這裡跟歌曲的 usable 相反：
  // 那邊預設保守（寧可多解釋），這邊預設安靜（硬說每句都難聽懂等於沒重點）
  if (typeof o.tricky !== 'boolean') o.tricky = false
  return true
}

export function isVideoLesson(v: unknown): v is VideoLesson {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.gist !== 'string') o.gist = ''
  if (typeof o.accent !== 'string') o.accent = ''
  if (!Array.isArray(o.lines)) return false
  o.lines = o.lines.filter(isLine)
  if ((o.lines as unknown[]).length === 0) return false
  if (!Array.isArray(o.reductions)) o.reductions = []
  if (!Array.isArray(o.fillers)) o.fillers = []
  if (!Array.isArray(o.chunks)) o.chunks = []
  return true
}

// ---------------- 貼上的逐字稿 ----------------

/**
 * 一次最多處理的字數。理由跟歌曲教材一樣是**不要逾時**：
 * 整份教材是一次請求產出的，輸入太長會讓輸出也跟著長。
 * 2000 字大約是三到五分鐘的講話量，而教材本來就只取其中 8-15 行精聽。
 */
export const TRANSCRIPT_MAX_CHARS = 2000
/** 少於這個長度多半是誤貼（只複製到標題或一兩句） */
export const TRANSCRIPT_MIN_CHARS = 80
