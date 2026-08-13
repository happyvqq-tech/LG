// 任務生成器 system prompt（CLAUDE.md 6.1，變數以模板注入）

import type { ErrorRecord, GrammarPoint, Level, TaskJson, TaskLanguage } from '../types'

export interface TaskGeneratorInput {
  language: TaskLanguage
  level: Level
  scenario: string
  grammarPoints: GrammarPoint[]
  pendingErrors: ErrorRecord[]
  /**
   * 還在 active 的近期錯誤，本次任務要刻意製造「用得到這個句型」的情境。
   *
   * 為什麼需要：狀態機原本只要「這次任務沒再犯」就累計一次，但沒再犯很可能
   * 只是任務根本沒用到那個句型。沒有製造機會就不算數，否則會累積出一堆
   * 假陽性的 resolved——學習者以為攻克了，系統也不再考他，那個錯誤就永久逃逸。
   */
  exposureErrors?: ErrorRecord[]
  /** 單字庫中學習中的字，讓任務自然用到（學了馬上碰到） */
  vocabWords?: string[]
  /** 成員自己填的興趣與近況，讓情境長在他真的在乎的事情上（migration-012） */
  interests?: string
  /** 這次是「意料之外」的情境（吵架、客訴、急診…），要有社交摩擦 */
  surprise?: boolean
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
