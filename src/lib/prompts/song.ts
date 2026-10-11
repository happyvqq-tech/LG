// 歌曲模組的輸入介面與回應驗證
//
// system prompt 本文在 worker/src/prompts/songPicker.ts 與 songLesson.ts，
// 這裡只留「呼叫端要帶什麼」跟「回來的東西長得對不對」（CLAUDE.md 第 6 節的分工）。

import type { Level, TaskLanguage } from '../types'

// ---------------- 選歌 ----------------

export interface SongPickerInput {
  language: TaskLanguage
  level: Level
  interests?: string
  exclude?: string[]
}

export interface SongSuggestion {
  title: string
  artist: string
  year: number
  /** 知名度 1-5 */
  fame: number
  /** 學習適用度 1-5（咬字、語速、重複率、語言實用度）*/
  learnability: number
  why: string
  caution: string
}

export interface SongPickerResult {
  songs: SongSuggestion[]
}

function isSuggestion(v: unknown): v is SongSuggestion {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  // caution 一定要有：prompt 明確要求「沒有缺點的歌不存在」，
  // 空的就代表模型在敷衍，那一筆的推薦理由也不會可信
  return (
    typeof o.title === 'string' && o.title.trim() !== '' &&
    typeof o.artist === 'string' && o.artist.trim() !== '' &&
    typeof o.why === 'string' && o.why.trim() !== '' &&
    typeof o.caution === 'string' && o.caution.trim() !== ''
  )
}

export function isSongPickerResult(v: unknown): v is SongPickerResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.songs) || o.songs.length === 0) return false
  o.songs = o.songs.filter(isSuggestion)
  return (o.songs as unknown[]).length > 0
}

// ---------------- 分段教學 ----------------

export interface SongLessonInput {
  language: TaskLanguage
  level: Level
  title: string
  artist: string
  lyrics: string
}

export interface SongLine {
  text: string
  zh: string
  /** 這句能不能原封不動拿去講。false＝歌詞限定 */
  usable: boolean
  /** usable 為 false 時：平常會怎麼講 */
  prose: string
  /** usable 為 false 時：為什麼（省略助詞、倒裝、文語…）*/
  note: string
}

export interface SongReduction {
  written: string
  sung: string
  note: string
}

/** 唱起來跟說起來不一樣的地方。唱歌會破壞英文重音與日文音高，這一項是矯正器 */
export interface SongProsody {
  line: string
  sung: string
  spoken: string
  note: string
}

export interface SongSegment {
  label: string
  lines: SongLine[]
  chunks: Array<{ text: string; zh: string; usage: string }>
  reductions: SongReduction[]
  prosody: SongProsody[]
}

export interface SongLesson {
  summary: string
  segments: SongSegment[]
}

function isLine(v: unknown): v is SongLine {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.text !== 'string' || o.text.trim() === '') return false
  // 這三個缺了就補空字串：少一句翻譯不該讓整首歌作廢，
  // 畫面那邊本來就會判斷有沒有內容再決定顯不顯示
  if (typeof o.zh !== 'string') o.zh = ''
  if (typeof o.prose !== 'string') o.prose = ''
  if (typeof o.note !== 'string') o.note = ''
  // usable 沒給就當成歌詞限定：寧可多解釋一句，也不要讓學習者
  // 把沒檢查過的歌詞當成可以直接講的話學走
  if (typeof o.usable !== 'boolean') o.usable = false
  return true
}

function isSegment(v: unknown): v is SongSegment {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.label !== 'string' || o.label.trim() === '') return false
  if (!Array.isArray(o.lines)) return false
  o.lines = o.lines.filter(isLine)
  if ((o.lines as unknown[]).length === 0) return false
  if (!Array.isArray(o.chunks)) o.chunks = []
  if (!Array.isArray(o.reductions)) o.reductions = []
  if (!Array.isArray(o.prosody)) o.prosody = []
  return true
}

export function isSongLesson(v: unknown): v is SongLesson {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.summary !== 'string') o.summary = ''
  if (!Array.isArray(o.segments)) return false
  o.segments = o.segments.filter(isSegment)
  return (o.segments as unknown[]).length > 0
}

// ---------------- 貼上的歌詞 ----------------

/** 一次最多處理的字數。整首超長的歌只取前面這麼多，避免 token 爆掉 */
export const LYRICS_MAX_CHARS = 2500
/** 少於這個長度多半是誤貼（複製到一半、貼到標題） */
export const LYRICS_MIN_CHARS = 40

/**
 * 整理貼進來的歌詞：串流平台複製出來常常夾帶
 * 「[Verse 1]」這種段落標記、翻譯行、以及一堆空行。
 * 清掉純粹是為了讓模型看到乾淨的原文，不改動歌詞本身的字。
 */
export function tidyLyrics(raw: string): string {
  return raw
    .split('\n')
    .map((l) => l.trim())
    // [Verse 1]、[Chorus]、(x2) 這類結構標記不是歌詞
    .filter((l) => l !== '' && !/^[[(【].{0,24}[\])】]$/.test(l))
    .join('\n')
    .slice(0, LYRICS_MAX_CHARS)
}
