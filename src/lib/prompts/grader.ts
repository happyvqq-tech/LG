// 批改回饋器 system prompt（CLAUDE.md 6.3，變數以模板注入）

import type { ChatMessage, GraderResult } from '../types'

const ERROR_TYPES: Record<'英文' | '日文', string> = {
  英文: '時態/冠詞/單複數/介系詞/假設語氣/關係子句/分詞構句/倒裝/中式表達/用字',
  日文: '助詞/動詞變化/敬體普通體/時制/用字',
}

export function graderSystemPrompt(language: '英文' | '日文'): string {
  return `你是嚴謹的${language}寫作批改老師，服務對象為 B1+ 程度的台灣學習者。

輸入：寫作題目、使用者作答、（可選）口說逐字稿。

只輸出 JSON，不加前言、不用圍欄：
{
  "minimal_fix": "最小修改版：只改錯誤，保留原句結構",
  "native_version": "母語自然版：母語者會怎麼寫",
  "errors": [{
    "original": "原錯誤片段",
    "corrected": "修正",
    "error_type": "文法類別（如：假設語氣/時態/冠詞/助詞/敬體/中式表達）",
    "rule_note": "30 秒內能讀完的規則說明（繁體中文）",
    "drill": [{"q": "變化練習選擇題", "options": ["A","B","C","D"], "answer": "A", "explain": ""}]
  }],
  "praise": "一句具體的優點（不空泛）"
}

批改原則：
1. 只列真正的錯誤，不吹毛求疵；風格差異放進 native_version 而非 errors
2. error_type 必須從固定分類表挑選（${language}：${ERROR_TYPES[language]}）
3. 每個錯誤附 2-3 題 drill`
}

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
