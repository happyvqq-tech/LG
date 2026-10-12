// 文章模組的輸入介面與回應驗證
//
// system prompt 本文在 worker/src/prompts/articleLesson.ts。

import type { Level, TaskLanguage } from '../types'

export interface ArticleLessonInput {
  language: TaskLanguage
  level: Level
  title: string
  text: string
}

/** 長句解剖：把修飾拿掉之後剩下的骨幹 */
export interface ArticleSentence {
  original: string
  backbone: string
  note: string
}

/** 指涉鏈：這個回指詞指向前面的哪一個 */
export interface ArticleRef {
  pointer: string
  refers_to: string
}

/** 書面 → 口語 */
export interface ArticleSpoken {
  written: string
  said: string
  note: string
}

export interface ArticleConnective {
  word: string
  role: string
}

export interface ArticleLesson {
  gist: string
  register: string
  sentences: ArticleSentence[]
  refs: ArticleRef[]
  spoken: ArticleSpoken[]
  connectives: ArticleConnective[]
  chunks: Array<{ text: string; zh: string; usage: string }>
}

/** 兩個欄位都要有才有意義的條目，少一邊就整筆丟掉 */
function pair(v: unknown, a: string, b: string): boolean {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o[a] === 'string' && o[a] !== '' && typeof o[b] === 'string' && o[b] !== ''
}

function isSentence(v: unknown): v is ArticleSentence {
  // original 與 backbone 缺一不可：只有原句沒有骨幹等於沒解剖，
  // 只有骨幹沒有原句則學習者在文章裡找不到那一句
  if (!pair(v, 'original', 'backbone')) return false
  const o = v as Record<string, unknown>
  if (typeof o.note !== 'string') o.note = ''
  return true
}

function isSpoken(v: unknown): v is ArticleSpoken {
  if (!pair(v, 'written', 'said')) return false
  const o = v as Record<string, unknown>
  if (typeof o.note !== 'string') o.note = ''
  return true
}

export function isArticleLesson(v: unknown): v is ArticleLesson {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>

  if (typeof o.gist !== 'string') o.gist = ''
  if (typeof o.register !== 'string') o.register = ''

  // 長句解剖是這份教材的核心，一句都沒有就等於沒做——讓它重試一次
  if (!Array.isArray(o.sentences)) return false
  o.sentences = o.sentences.filter(isSentence)
  if ((o.sentences as unknown[]).length === 0) return false

  // 其餘都是加分項，缺了就讓畫面自己把那一區收起來
  o.refs = Array.isArray(o.refs) ? o.refs.filter((r) => pair(r, 'pointer', 'refers_to')) : []
  o.spoken = Array.isArray(o.spoken) ? o.spoken.filter(isSpoken) : []
  o.connectives = Array.isArray(o.connectives)
    ? o.connectives.filter((c) => pair(c, 'word', 'role'))
    : []
  o.chunks = Array.isArray(o.chunks) ? o.chunks : []
  return true
}

// ---------------- 推薦 ----------------

export interface ArticlePickerInput {
  language: TaskLanguage
  level: Level
  topic?: string
  interests?: string
  items: Array<{ title: string; summary: string; source: string }>
}

export interface ArticlePick {
  /** 清單裡的索引——驗證時已確認在範圍內且不重複 */
  index: number
  why: string
  caution: string
  /** 1-5，以這位學習者的程度為基準 */
  difficulty: number
}

export interface ArticlePickerResult {
  picks: ArticlePick[]
}

/**
 * 推薦結果的驗證。要知道清單有幾則才能驗索引，所以做成工廠函式。
 *
 * 這裡是「AI 不可能推薦不存在的文章」真正被保證的地方：
 * prompt 只是請它照規矩來，索引超出範圍、不是整數、或重複的，在這裡一律丟掉。
 */
export function makeIsArticlePickerResult(itemCount: number) {
  return (v: unknown): v is ArticlePickerResult => {
    if (typeof v !== 'object' || v === null) return false
    const o = v as Record<string, unknown>
    if (!Array.isArray(o.picks)) return false

    const seen = new Set<number>()
    o.picks = o.picks.filter((p): p is ArticlePick => {
      if (typeof p !== 'object' || p === null) return false
      const r = p as Record<string, unknown>
      const i = r.index
      if (typeof i !== 'number' || !Number.isInteger(i) || i < 0 || i >= itemCount) return false
      if (seen.has(i)) return false
      // caution 一定要有：prompt 明講「沒有缺點的素材不存在」，
      // 空的代表模型在敷衍，那筆的推薦理由也不會可信
      if (typeof r.why !== 'string' || r.why.trim() === '') return false
      if (typeof r.caution !== 'string' || r.caution.trim() === '') return false
      const d = typeof r.difficulty === 'number' ? Math.round(r.difficulty) : 3
      r.difficulty = Math.min(5, Math.max(1, d))
      seen.add(i)
      return true
    })

    return (o.picks as unknown[]).length > 0
  }
}

// ---------------- 篇幅 ----------------

/**
 * 一次分析的字數上限。
 *
 * 跟逐字稿不同，這裡**存進資料庫的跟送進 prompt 的是同一份**——
 * 學習者會對照著原文讀教材，如果分析只涵蓋前三分之一而畫面顯示全文，
 * 他會一直找不到教材在講哪一句。寧可整篇短一點，也不要分析跟內文對不上。
 *
 * 3000 字元在英文大約 500 詞（一般新聞的長度），在日韓是一篇中長篇。
 */
export const ARTICLE_MAX_CHARS = 3000
/** 少於這個長度多半是只貼到導言，或者抓到付費牆的前兩段 */
export const ARTICLE_MIN_CHARS = 200
