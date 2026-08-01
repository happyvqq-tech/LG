// 對話角色 system prompt（CLAUDE.md 6.2，變數以模板注入）

import type { TaskLanguage } from '../types'

export interface DialogPartnerInput {
  language: TaskLanguage
  roleSetup: string
  goal: string
}

export const TASK_COMPLETE_MARKER = '[TASK_COMPLETE]'
export const HINT_REQUEST = 'HINT_REQUEST'

/** AI 先開口的引導訊息（不顯示於畫面，只作為 API 對話的第一個 user turn） */
export const DIALOG_BOOTSTRAP = {
  role: 'user' as const,
  content: '（系統）對話開始，請依你的角色設定先開口說第一句。',
}

export function stripCompleteMarker(text: string): string {
  return text.replace('[TASK_COMPLETE]', '').trim()
}
