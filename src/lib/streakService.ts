// 連續天數（streak）資料層：各學習模組完成一個有意義的動作時呼叫 logActivity，
// 寫入失敗不該擋住主流程。純計算邏輯見 streakRules.ts（可獨立測試）。
import { supabase } from './supabase'
import { toDateString, addDays } from './srs'
import { computeStreak } from './streakRules'

export { computeStreak, EMPTY_STREAK } from './streakRules'
export type { StreakInfo } from './streakRules'

/** 任一模組完成動作時呼叫；同一天重複呼叫安全（ignoreDuplicates） */
export async function logActivity(profileId: string, when = new Date()): Promise<void> {
  const { error } = await supabase
    .from('activity_log')
    .upsert(
      { profile_id: profileId, activity_date: toDateString(when) },
      { onConflict: 'profile_id,activity_date', ignoreDuplicates: true },
    )
  if (error) throw new Error(error.message)
}

/** 讀最近 90 天的活動紀錄並算出目前/最長連續天數與近 7 天概況 */
export async function getStreak(profileId: string, now = new Date()) {
  const since = toDateString(addDays(now, -90))
  const { data, error } = await supabase
    .from('activity_log')
    .select('activity_date')
    .eq('profile_id', profileId)
    .gte('activity_date', since)
    .order('activity_date')
  if (error) throw new Error(error.message)

  const dates = new Set(((data ?? []) as Array<{ activity_date: string }>).map((r) => r.activity_date))
  return computeStreak(dates, now)
}
