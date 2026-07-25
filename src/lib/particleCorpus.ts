// 從《古文觀止》真實語料抽取含指定虛詞的短句，供虛詞練習使用
// 抽句邏輯是純函式（見 extractClauses），資料載入才碰 IO（動態載入的原文 JSON）
import { loadClassicalTexts } from '../data/classicalIndex'

const CLAUSE_SPLIT = /[，、。；：？！「」『』]/g
const MIN_LEN = 3
const MAX_LEN = 40

/** 純函式：把一段原文切成短句，回傳「恰好出現一次目標字」且長度適中的候選 */
export function extractClauses(paragraphs: string[], word: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const para of paragraphs) {
    for (const raw of para.split(CLAUSE_SPLIT)) {
      const clause = raw.trim()
      if (!clause || seen.has(clause)) continue
      if (clause.length < MIN_LEN || clause.length > MAX_LEN) continue
      const count = clause.split(word).length - 1
      if (count !== 1) continue
      seen.add(clause)
      out.push(clause)
    }
  }
  return out
}

function shuffle<T>(list: T[]): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** 從全部《古文觀止》語料中隨機抽出含該虛詞的句子（每次呼叫結果不同，確保練習遇到新句子） */
export async function findClauses(word: string, limit = 3): Promise<string[]> {
  const texts = await loadClassicalTexts()
  const all: string[] = []
  for (const paras of Object.values(texts)) {
    all.push(...extractClauses(paras, word))
  }
  return shuffle(all).slice(0, limit)
}
