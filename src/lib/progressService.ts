// 進步存摺的資料層：把散在五張表裡的紀錄一次撈回來，交給 progressRules 算。
//
// 這一頁完全不呼叫 AI——所有數字都是資料庫裡本來就有的東西，只是以前沒有
// 地方看得到。所以它不花任何 API 費用，也可以隨便重新整理。
//
// 查詢一律不帶 language 篩選：存摺是「這個人」的累積，不是「這個語言」的。
// 一個同時學英日文的成員，兩邊的努力都該算進同一本存摺裡。

import { supabase } from './supabase'
import { toDateString, addDays } from './srs'
import { EMPTY_RAW, type ProgressRaw } from './progressRules'

/** 抓取範圍：一年。存摺的「累積」以這個窗口為準，超過一年前的不算進來 */
const WINDOW_DAYS = 365

/**
 * errors 的 resolved_at 是 migration-011 才加的欄位。
 * 還沒跑那支 migration 的資料庫會回 42703（欄位不存在），這時退回不帶該欄位的
 * 查詢，頁面照常顯示，只是「攻克錯誤」沒有期間對照。
 * 這樣使用者可以先看到頁面、再決定要不要去跑 SQL，而不是被一片紅字擋在外面。
 */
async function fetchErrors(profileId: string, since: string) {
  const columns = 'created_at,status,error_type,language,resolved_at'
  const query = () =>
    supabase.from('errors').select(columns).eq('profile_id', profileId).gte('created_at', since)

  const { data, error } = await query()
  if (!error) {
    return {
      rows: (data ?? []) as ProgressRaw['errors'],
      hasResolvedAt: true,
    }
  }

  const fallback = await supabase
    .from('errors')
    .select('created_at,status,error_type,language')
    .eq('profile_id', profileId)
    .gte('created_at', since)
  if (fallback.error) throw new Error(fallback.error.message)

  const rows = (fallback.data ?? []) as Array<Omit<ProgressRaw['errors'][number], 'resolved_at'>>
  return { rows: rows.map((r) => ({ ...r, resolved_at: null })), hasResolvedAt: false }
}

export interface ProgressLoad {
  raw: ProgressRaw
  /** 資料庫有沒有 resolved_at 欄位（沒有就提示去跑 migration-011） */
  hasResolvedAt: boolean
}

export async function loadProgress(profileId: string, now = new Date()): Promise<ProgressLoad> {
  const since = toDateString(addDays(now, -WINDOW_DAYS))
  const sinceISO = new Date(`${since}T00:00:00`).toISOString()

  const [activity, vocab, quizzes, tasks, errors] = await Promise.all([
    supabase.from('activity_log').select('activity_date').eq('profile_id', profileId).gte('activity_date', since),
    supabase.from('vocab_cards').select('created_at').eq('profile_id', profileId),
    supabase.from('vocab_quizzes').select('quiz_date,score,total').eq('profile_id', profileId).gte('quiz_date', since),
    supabase
      .from('tasks')
      .select('completed_at')
      .eq('profile_id', profileId)
      .eq('status', 'done')
      .not('completed_at', 'is', null)
      .gte('created_at', sinceISO),
    fetchErrors(profileId, sinceISO),
  ])

  for (const r of [activity, vocab, quizzes, tasks]) {
    if (r.error) throw new Error(r.error.message)
  }

  const raw: ProgressRaw = {
    ...EMPTY_RAW,
    activityDates: ((activity.data ?? []) as Array<{ activity_date: string }>).map((r) => r.activity_date),
    // 單字卡刻意不設時間下限：累積曲線要的就是「總共存了幾個字」，
    // 一年前學的字今天還是在你腦子裡，不該從餘額裡消失
    vocabCreatedAt: ((vocab.data ?? []) as Array<{ created_at: string }>).map((r) => r.created_at),
    quizzes: (quizzes.data ?? []) as ProgressRaw['quizzes'],
    taskCompletedAt: ((tasks.data ?? []) as Array<{ completed_at: string }>).map((r) => r.completed_at),
    errors: errors.rows,
  }

  return { raw, hasResolvedAt: errors.hasResolvedAt }
}
