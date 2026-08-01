// 覆盤加練：根據本次錯誤生成「類似題」，換情境但考同一個規則
// 沿用批改回饋器（sonnet）模組，輸出 JSON

import type { DrillQuestion, GraderError, TaskLanguage } from '../types'

export interface ReviewPracticeInput {
  /** 錯誤庫複習：任務語言之外，古文也共用這支 prompt */
  language: TaskLanguage | '古文'
  errors: GraderError[]
}

export interface ReviewPracticeResult {
  questions: DrillQuestion[]
}

export function isReviewPracticeResult(v: unknown): v is ReviewPracticeResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.questions) || o.questions.length === 0) return false
  return o.questions.every((q) => {
    if (typeof q !== 'object' || q === null) return false
    const item = q as Record<string, unknown>
    return (
      typeof item.q === 'string' &&
      Array.isArray(item.options) &&
      item.options.length >= 2 &&
      item.options.every((opt) => typeof opt === 'string') &&
      typeof item.answer === 'string' &&
      typeof item.explain === 'string'
    )
  })
}
