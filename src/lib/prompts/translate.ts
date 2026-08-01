// 聽力稿逐句中文翻譯——只在使用者第一次按「顯示中文」時呼叫一次，
// 結果存進 task_json 快取，之後不再重複呼叫（見 lib/translationService.ts）
// 沿用批改回饋器（grader/sonnet）模組，輸出 JSON

import type { TaskLanguage } from '../types'

export interface TranslateInput {
  language: TaskLanguage
  sentences: string[]
}

export interface TranslateResult {
  translations: string[]
}

/** 驗證需要知道預期句數，才能擋住「AI 少翻一句/多翻一句」這種結構對得上但內容對不齊的情況 */
export function makeIsTranslateResult(expectedCount: number) {
  return (v: unknown): v is TranslateResult => {
    if (typeof v !== 'object' || v === null) return false
    const o = v as Record<string, unknown>
    if (!Array.isArray(o.translations)) return false
    if (o.translations.length !== expectedCount) return false
    return o.translations.every((t) => typeof t === 'string' && t.trim() !== '')
  }
}
