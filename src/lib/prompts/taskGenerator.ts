// 任務生成器 system prompt（CLAUDE.md 6.1，變數以模板注入）

import type { ErrorRecord, GrammarPoint, Level, TaskJson } from '../types'

export interface TaskGeneratorInput {
  language: '英文' | '日文'
  level: Level
  scenario: string
  grammarPoints: GrammarPoint[]
  pendingErrors: ErrorRecord[]
}

export function taskGeneratorSystemPrompt(input: TaskGeneratorInput): string {
  const grammarList = input.grammarPoints
    .map((g) => `${g.name}（${g.level}）：${g.description}`)
    .join('；')
  const errorList =
    input.pendingErrors.length > 0
      ? input.pendingErrors
          .map((e) => `「${e.original}」應為「${e.corrected}」（${e.error_type}）`)
          .join('；')
      : '無'

  return `你是語言學習任務設計師。根據以下輸入生成一個 8-15 分鐘的任務式學習循環。

輸入變數：
- 語言：${input.language}
- 程度：${input.level}
- 情境類別：${input.scenario}
- 本週文法點：${grammarList}
- 待驗證錯誤：${errorList}

硬性要求：
0. 程度為 A2（初級）時：聽力稿縮短為 100-150 字、句子放短、只用常見高頻字，語塊改為 4-6 個；B1 以上依下列原則
1. 聽力稿 150-250 字，口語自然，必須自然融入指定文法點至少 3 次
2. 若有待驗證錯誤，必須在對話任務或寫作題中刻意設計會用到該句型的情境（不明說）
3. 語塊（chunks）給 5-8 個，是可整段套用的片語，不是單字
4. 寫作題必須與情境直接相關，30-80 字即可完成
5. 日文任務需標註丁寧體/普通體要求

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "scenario_title": "",
  "scenario_desc": "",
  "listening_script": "",
  "chunks": [{"text": "", "zh": "", "usage": ""}],
  "speaking_goal": "",
  "speaking_role_setup": "AI 扮演的角色與立場",
  "writing_prompt": "",
  "grammar_points_used": []
}`
}

/** 驗證任務生成器輸出的最小必要結構 */
export function isTaskJson(v: unknown): v is TaskJson {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const strFields = [
    'scenario_title',
    'scenario_desc',
    'listening_script',
    'speaking_goal',
    'speaking_role_setup',
    'writing_prompt',
  ]
  if (!strFields.every((f) => typeof o[f] === 'string' && (o[f] as string).length > 0)) return false
  if (!Array.isArray(o.chunks) || o.chunks.length === 0) return false
  if (
    !o.chunks.every(
      (c) => typeof c === 'object' && c !== null && typeof (c as Record<string, unknown>).text === 'string',
    )
  )
    return false
  if (!Array.isArray(o.grammar_points_used)) o.grammar_points_used = []
  return true
}
