// 古文翻譯錯誤同步的純邏輯（不依賴 Supabase，可獨立測試）
// IO 版本見 classicalErrorEngine.ts
import { computeErrorTransitions, isSimilarError, type ErrorTransition } from './errorRules'
import type { TranslationIssue } from './prompts/classicalTutor'
import type { ErrorRecord } from './types'

export interface ClassicalErrorPlan {
  /** 應該新建為 active 錯誤的項目（跟任何既有未解決錯誤都不相似） */
  toInsert: TranslationIssue[]
  /** 應該對既有錯誤做的狀態機更新 */
  updates: ErrorTransition[]
}

/**
 * 純函式：規劃這次翻譯批改結果該怎麼同步進錯誤庫。
 * @param passage 本次翻譯的段落原文（含標點）——只有錯誤的原文片段真的
 *   出現在這段裡，才有資格被這次結果推進狀態機（古文無法像現代語言任務
 *   生成器那樣刻意埋設情境來驗證，用「這段真的包含這個構造」代替）
 */
export function planClassicalErrorSync(
  existing: ErrorRecord[],
  passage: string,
  issues: TranslationIssue[],
): ClassicalErrorPlan {
  const toInsert = issues.filter(
    (iss) => !existing.some((ex) => isSimilarError({ original: iss.original, error_type: iss.error_type }, ex)),
  )

  const currentErrors = issues.map((i) => ({ original: i.original, error_type: i.error_type }))
  const relevantExisting = existing.filter((ex) => passage.includes(ex.original))
  const verifyIds = new Set(relevantExisting.filter((ex) => ex.status === 'pending_verify').map((ex) => ex.id))
  const updates =
    relevantExisting.length === 0 ? [] : computeErrorTransitions(relevantExisting, currentErrors, new Set(), verifyIds)

  return { toInsert, updates }
}
