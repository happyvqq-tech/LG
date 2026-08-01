// 週報資料層：抓近 30 天錯誤紀錄、呼叫 AI 生成 Markdown（不落地儲存，每次即時生成）
import { supabase } from './supabase'
import { callClaude } from './claude'
import { type WeeklyReportInput } from './prompts/weeklyReport'
import { toDateString, addDays } from './srs'
import type { ErrorRecord } from './types'

/** 這位成員曾經產生過錯誤紀錄的語言（供週報頁面做語言選擇） */
export async function getLanguagesWithErrors(profileId: string): Promise<string[]> {
  const { data, error } = await supabase.from('errors').select('language').eq('profile_id', profileId)
  if (error) throw new Error(error.message)
  return [...new Set(((data ?? []) as Array<{ language: string }>).map((r) => r.language))]
}

async function fetchRecentErrors(profileId: string, language: string): Promise<ErrorRecord[]> {
  const since = toDateString(addDays(new Date(), -30))
  const { data, error } = await supabase
    .from('errors')
    .select('*')
    .eq('profile_id', profileId)
    .eq('language', language)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ErrorRecord[]
}

/** 去掉回應外層可能誤加的 ``` 圍欄（prompt 已要求不要加，這裡只是保險） */
function stripOuterFence(s: string): string {
  const trimmed = s.trim()
  if (trimmed.startsWith('```') && trimmed.endsWith('```')) {
    return trimmed.replace(/^```[a-z]*\n?/i, '').replace(/```$/, '').trim()
  }
  return trimmed
}

export interface WeeklyReportOutcome {
  markdown: string
  errorCount: number
}

/**
 * 生成週報。errors 為空時直接回傳空 markdown（呼叫端顯示「沒有紀錄」），
 * 不浪費一次 API 呼叫。
 */
export async function generateWeeklyReport(
  profileId: string,
  profileName: string,
  language: string,
): Promise<WeeklyReportOutcome> {
  const errors = await fetchRecentErrors(profileId, language)
  if (errors.length === 0) return { markdown: '', errorCount: 0 }

  const text = await callClaude({
    promptModule: 'weeklyReport',
    vars: { profileName, language, errors } satisfies WeeklyReportInput,
    messages: [{ role: 'user', content: '請生成本週週報' }],
  })
  return { markdown: stripOuterFence(text), errorCount: errors.length }
}
