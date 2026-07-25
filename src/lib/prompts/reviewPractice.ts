// 覆盤加練：根據本次錯誤生成「類似題」，換情境但考同一個規則
// 沿用批改回饋器（sonnet）模組，輸出 JSON

import type { DrillQuestion, GraderError } from '../types'

export interface ReviewPracticeInput {
  language: '英文' | '日文'
  errors: GraderError[]
}

export function reviewPracticeSystemPrompt(input: ReviewPracticeInput): string {
  const errorList = input.errors
    .map((e) => `「${e.original}」→「${e.corrected}」（${e.error_type}：${e.rule_note}）`)
    .join('\n')

  return `你是${input.language}教學設計師，服務對象為台灣學習者。

以下是學習者本次犯的錯誤：
${errorList}

請針對這些錯誤出 4 題選擇題作為「類似題練習」。

要求：
1. 每題考的是同一條規則，但情境、句子內容必須與原錯誤完全不同（不可只改幾個字）
2. 依錯誤類別分配題數；若某類錯誤犯得較多，該類多出一題
3. 選項 4 個，錯誤選項要是台灣學習者真的會犯的錯，不要湊數
4. explain 用繁體中文，30 秒內能讀完，直接說明為什麼選這個、為什麼別的不行
5. 題目難度貼近原錯誤，不要突然變難

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "questions": [
    {"q": "題目（含空格或提問）", "options": ["A選項","B選項","C選項","D選項"], "answer": "正確選項的完整文字", "explain": "解說"}
  ]
}`
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
