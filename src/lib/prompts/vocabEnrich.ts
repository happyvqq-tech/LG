// 單字補完器：一次把整批新字補上音標、例句、搭配詞
// 混合模式的「AI」那一半——內建字表只給字與中文，語境由 AI 生成
// 內建字表用完時，也用同一支 prompt 直接生成新字

import type { VocabSeed } from '../../data/vocabLists'
import type { TaskLanguage } from '../types'

export interface VocabEnrichInput {
  language: TaskLanguage
  exam: string
  examLevel: string
  /** 要補完的字（來自內建字表）；留空表示請 AI 直接產生新字 */
  seeds: VocabSeed[]
  /** 需要幾個字（seeds 為空時使用） */
  count: number
  /** 已學過的字，避免重複 */
  known: string[]
}

export interface EnrichedWord {
  word: string
  reading: string
  meaning_zh: string
  pos: string
  example: string
  example_zh: string
  collocations: string[]
}

export interface VocabEnrichResult {
  words: EnrichedWord[]
}

export function isVocabEnrichResult(v: unknown): v is VocabEnrichResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.words) || o.words.length === 0) return false
  return o.words.every((w) => {
    if (typeof w !== 'object' || w === null) return false
    const item = w as Record<string, unknown>
    if (typeof item.word !== 'string' || item.word.trim() === '') return false
    if (typeof item.meaning_zh !== 'string') return false
    // 其餘欄位缺漏時可補空字串，不因此判定失敗
    return true
  })
}

/** 把 AI 回傳的資料正規化，缺欄位補預設值 */
export function normalizeEnriched(w: EnrichedWord): EnrichedWord {
  return {
    word: String(w.word ?? '').trim(),
    reading: String(w.reading ?? '').trim(),
    meaning_zh: String(w.meaning_zh ?? '').trim(),
    pos: String(w.pos ?? '').trim(),
    example: String(w.example ?? '').trim(),
    example_zh: String(w.example_zh ?? '').trim(),
    collocations: Array.isArray(w.collocations)
      ? w.collocations.filter((c) => typeof c === 'string' && c.trim() !== '').slice(0, 4)
      : [],
  }
}
