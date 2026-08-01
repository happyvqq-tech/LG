// 週報生成器（CLAUDE.md 6.4）：讀近 30 天 errors 紀錄，生成繁體中文 Markdown 週報
import type { ErrorRecord } from '../types'

export interface WeeklyReportInput {
  profileName: string
  language: string
  /** 近 30 天的錯誤紀錄（含已 resolved 的，讓 AI 看得到進步） */
  errors: ErrorRecord[]
}
