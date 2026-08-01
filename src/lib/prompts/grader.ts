// 批改回饋器 system prompt（CLAUDE.md 6.3，變數以模板注入）

import type { ChatMessage, GraderResult } from '../types'

/** 組合送給批改器的 user 訊息 */
export function graderUserMessage(args: {
  writingPrompt: string
  answer: string
  speakingTranscript?: ChatMessage[]
}): string {
  const transcript =
    args.speakingTranscript && args.speakingTranscript.length > 0
      ? args.speakingTranscript
          .map((m) => `${m.role === 'user' ? '學生' : '對話角色'}：${m.content}`)
          .join('\n')
      : '（無）'
  return `寫作題目：${args.writingPrompt}

使用者作答：
${args.answer}

口說逐字稿（供參考，錯誤也可納入批改）：
${transcript}`
}

export function isGraderResult(v: unknown): v is GraderResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.minimal_fix !== 'string' || typeof o.native_version !== 'string') return false
  if (typeof o.praise !== 'string') o.praise = ''
  if (!Array.isArray(o.errors)) return false
  return o.errors.every((e) => {
    if (typeof e !== 'object' || e === null) return false
    const err = e as Record<string, unknown>
    if (typeof err.original !== 'string' || typeof err.corrected !== 'string') return false
    if (typeof err.error_type !== 'string') return false
    if (typeof err.rule_note !== 'string') err.rule_note = ''
    if (!Array.isArray(err.drill)) err.drill = []
    return true
  })
}
