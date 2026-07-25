// 連續天數（streak）的純邏輯——不依賴 Supabase，可獨立測試
import { toDateString, addDays, parseDateString } from './srs'

export interface StreakInfo {
  /** 目前連續天數：今天或昨天有活動才算「連續中」，否則歸零 */
  current: number
  /** 歷史最長連續天數 */
  longest: number
  /** 最近 7 天，索引 0=6 天前…6=今天，是否有活動 */
  last7: boolean[]
  /** 今天是否已經記錄活動 */
  activeToday: boolean
}

export const EMPTY_STREAK: StreakInfo = { current: 0, longest: 0, last7: Array(7).fill(false), activeToday: false }

/** 由活動日期集合算出連續天數資訊 */
export function computeStreak(dates: Set<string>, now: Date): StreakInfo {
  if (dates.size === 0) return EMPTY_STREAK

  const today = toDateString(now)
  const activeToday = dates.has(today)

  // 目前連續天數：今天有動作就從今天數，否則從昨天數（今天還沒做不代表 streak 已斷）
  let current = 0
  let cursor = activeToday ? now : addDays(now, -1)
  while (dates.has(toDateString(cursor))) {
    current++
    cursor = addDays(cursor, -1)
  }

  // 最長連續天數：掃過整個已抓取範圍
  const sorted = [...dates].sort()
  let longest = 0
  let run = 0
  let prev: string | null = null
  for (const d of sorted) {
    run = prev && toDateString(addDays(parseDateString(prev), 1)) === d ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = d
  }
  longest = Math.max(longest, current)

  const last7 = Array.from({ length: 7 }, (_, i) => dates.has(toDateString(addDays(now, i - 6))))

  return { current, longest, last7, activeToday }
}
