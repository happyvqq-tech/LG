// 聽力稿逐句中文翻譯——只在使用者第一次按「顯示中文」時呼叫一次，
// 結果存進 task_json 快取，之後不再重複呼叫（見 lib/translationService.ts）
// 沿用批改回饋器（grader/sonnet）模組，輸出 JSON

import type { TaskLanguage } from '../types'

export interface TranslateInput {
  language: TaskLanguage
  sentences: string[]
}

export function translateSystemPrompt(input: TranslateInput): string {
  const numbered = input.sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')

  return `你是${input.language}翻譯，服務對象為台灣的語言學習者。

以下是一段聽力稿，已經照原本順序切成 ${input.sentences.length} 句：
${numbered}

請把每一句翻成自然、道地的繁體中文（不要逐字硬翻），供學習者聽完後對照理解用。

硬性要求：
1. translations 陣列長度必須剛好 ${input.sentences.length}，順序跟原句一一對應，不可合併或拆開句子
2. 翻譯以達意、通順為主，不用附註解或原文

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "translations": ["第一句翻譯", "第二句翻譯"]
}`
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
