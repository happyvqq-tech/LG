// 全家一週狀態的資料層
//
// 關鍵是「不要 N+1」：成員雖然只有 2-4 個，但每人四張表就是十幾個查詢，
// 而這是首頁——選成員之前就要跑完。所以四張表各查一次，用 .in(profile_id)
// 一次撈所有人的資料，回來在前端分組。
//
// 這頁完全不呼叫 AI。摘要是規則產生的（見 familyRules.ts）。

import { supabase } from './supabase'
import { toDateString, addDays } from './srs'
import { computeStreak } from './streakRules'
import type { MemberWeek } from './familyRules'
import type { Profile } from './types'

/** 連續天數要往回看夠久才算得準 */
const STREAK_WINDOW_DAYS = 90
/** 「本週」一律指最近 7 天，不是週一到週日——後者在週一早上會全部歸零，很打擊人 */
const WEEK_DAYS = 7

function groupCount<T>(rows: T[], key: (r: T) => string): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1)
  return m
}

/**
 * errors.resolved_at 是 migration-011 才加的欄位，沒跑就退回不查。
 * 全家榜少一項「本週攻克」，其他照常顯示——不能因為少一欄就讓首頁壞掉。
 */
async function fetchResolved(ids: string[], sinceISO: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('errors')
    .select('profile_id')
    .in('profile_id', ids)
    .eq('status', 'resolved')
    .gte('resolved_at', sinceISO)
  if (error) return new Map()
  return groupCount((data ?? []) as Array<{ profile_id: string }>, (r) => r.profile_id)
}

/** 讀全家最近一週的狀態。任何一張表失敗都只讓該項為 0，不讓整個看板消失 */
export async function loadFamilyWeek(profiles: Profile[], now = new Date()): Promise<MemberWeek[]> {
  if (profiles.length === 0) return []
  const ids = profiles.map((p) => p.id)
  const streakSince = toDateString(addDays(now, -STREAK_WINDOW_DAYS))
  const weekSince = toDateString(addDays(now, -(WEEK_DAYS - 1)))
  const weekSinceISO = new Date(`${weekSince}T00:00:00`).toISOString()

  const [activity, vocab, resolved] = await Promise.all([
    supabase.from('activity_log').select('profile_id,activity_date').in('profile_id', ids).gte('activity_date', streakSince),
    supabase.from('vocab_cards').select('profile_id').in('profile_id', ids).gte('created_at', weekSinceISO),
    fetchResolved(ids, weekSinceISO),
  ])

  const activityRows = (activity.error ? [] : (activity.data ?? [])) as Array<{
    profile_id: string
    activity_date: string
  }>
  const datesByProfile = new Map<string, Set<string>>()
  for (const r of activityRows) {
    const set = datesByProfile.get(r.profile_id) ?? new Set<string>()
    set.add(r.activity_date)
    datesByProfile.set(r.profile_id, set)
  }

  const vocabCounts = vocab.error
    ? new Map<string, number>()
    : groupCount((vocab.data ?? []) as Array<{ profile_id: string }>, (r) => r.profile_id)

  return profiles.map((p) => {
    const dates = datesByProfile.get(p.id) ?? new Set<string>()
    const streak = computeStreak(dates, now)
    return {
      profileId: p.id,
      name: p.name,
      streak: streak.current,
      practiceDays: streak.last7.filter(Boolean).length,
      resolved: resolved.get(p.id) ?? 0,
      newVocab: vocabCounts.get(p.id) ?? 0,
      last7: streak.last7,
    }
  })
}
