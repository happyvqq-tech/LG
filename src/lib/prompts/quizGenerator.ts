// 每日測驗出題：針對已學過的字，出「全新情境」的填空題
//
// 關鍵設計：句子必須是新的，不能沿用單字卡上那句例句。
// 沿用的話測到的是「記不記得那句話」，不是「會不會用這個字」。

import type { TaskLanguage, VocabCard } from '../types'

export const BLANK = '___'

export interface QuizGenInput {
  language: TaskLanguage
  exam: string
  examLevel: string
  cards: VocabCard[]
}

export interface QuizQuestionRaw {
  word: string
  sentence: string
  sentence_zh: string
  hint: string
  /** 填入 ${BLANK} 處的實際文字（日韓是活用/敬語變化後的形式，其他語言等於 word） */
  answer_surface: string
}

export interface QuizGenResult {
  questions: QuizQuestionRaw[]
}

export function isQuizGenResult(v: unknown): v is QuizGenResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.questions) || o.questions.length === 0) return false
  return o.questions.every((q) => {
    if (typeof q !== 'object' || q === null) return false
    const item = q as Record<string, unknown>
    return (
      typeof item.word === 'string' &&
      typeof item.sentence === 'string' &&
      typeof item.answer_surface === 'string' &&
      item.answer_surface.trim() !== ''
    )
  })
}

/**
 * 修掉 AI 可能犯的兩個錯：句子沒有空格、或句子裡直接寫出答案。
 * 日韓的答案是活用後的 answerSurface，跟辭書形 word 常常不同兩個字串，
 * 兩個都要檢查洩題，只檢查 word 會漏掉「句子裡直接寫出活用形」這種洩漏。
 * 回傳 null 代表這題無法補救，呼叫端應丟棄。
 */
export function sanitizeSentence(sentence: string, word: string, answerSurface?: string): string | null {
  let s = String(sentence ?? '').trim()
  if (s === '') return null

  // 統一各種底線寫法為標準空格標記
  s = s.replace(/_{2,}|＿{2,}/g, BLANK)

  const forms = [word, ...(answerSurface && answerSurface !== word ? [answerSurface] : [])]
  for (const form of forms) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 答案外洩時就地挖空（連同常見變化形字尾一起吃掉）
    const leak = new RegExp(`\\b${escaped}(s|es|ed|ing|d)?\\b`, 'gi')
    if (leak.test(s)) s = s.replace(leak, BLANK)
    // 非英數語言沒有 \b 可用，直接比對字面
    if (s.includes(form)) s = s.split(form).join(BLANK)
  }

  const blanks = s.split(BLANK).length - 1
  if (blanks === 0) return null
  // 多個空格時只留第一個，其餘還原不了就丟棄
  if (blanks > 1) return null

  return s
}
