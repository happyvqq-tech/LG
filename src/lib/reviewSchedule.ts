// 間隔重聽排程——純函式，方便單元測試
//
// 為什麼需要這個：一篇聽力稿生成當天被聽 2 次（Listening 的 listenCount>=2）
// 之後就再也不會出現。單字有完整的 SRS（srs.ts），聽力稿卻完全沒有，
// 這是整個系統最不對稱的地方——聽力稿的資訊密度遠高於單字卡，它同時承載
// 語塊、文法點、語流與語調，重聽的邊際成本又幾乎是零（音檔已經在快取裡）。
//
// 這裡不做完整的 SM-2：教材不像單字有「答對答錯」可以調整間隔，
// 固定的遞增區間（1/3/7/14/30 天）就夠用，也不必為此加資料表。

import type { Task } from './types'

interface ReviewBucket {
  label: string
  /** 理想的間隔天數 */
  target: number
  /** 實際可接受的範圍——沒有人會每天練，硬要求剛好第 3 天會讓排程常常是空的 */
  min: number
  max: number
}

/**
 * 區間刻意不重疊且逐段放寬：越久以前的教材，容許的誤差越大。
 * 上限 60 天是避免翻出太久以前、情境早就忘光的東西當「複習」。
 */
const REVIEW_BUCKETS: ReviewBucket[] = [
  { label: '昨天', target: 1, min: 1, max: 2 },
  { label: '3 天前', target: 3, min: 3, max: 5 },
  { label: '一週前', target: 7, min: 6, max: 10 },
  { label: '兩週前', target: 14, min: 11, max: 21 },
  { label: '一個月前', target: 30, min: 22, max: 60 },
]

/** 本地時區的「YYYY-MM-DD」。不能用 toISOString——那是 UTC，台灣時間早上 8 點前會算成前一天 */
function localDateKey(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 相差幾個「日曆天」（不是 24 小時）——昨晚 11 點和今早 1 點是相差 1 天，不是 0 天 */
export function daysAgo(iso: string, now: Date): number {
  const then = new Date(iso)
  then.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return Math.round((today.getTime() - then.getTime()) / 86400000)
}

export interface ReviewPick {
  task: Task
  /** 「昨天」「一週前」等，直接顯示給使用者 */
  label: string
  daysAgo: number
}

/**
 * 挑出今天該回去重聽的教材，每個間隔最多一篇。
 *
 * 同一篇不會被兩個區間重複挑到（先到先得，區間由近到遠），
 * 所以教材很少的時候只會排出一兩篇，而不是同一篇列五次。
 */
export function pickReviewTasks(tasks: Task[], now: Date): ReviewPick[] {
  const used = new Set<string>()
  const picks: ReviewPick[] = []

  for (const bucket of REVIEW_BUCKETS) {
    const candidates = tasks
      .filter((t) => !used.has(t.id))
      .map((t) => ({ task: t, age: daysAgo(t.created_at, now) }))
      .filter((c) => c.age >= bucket.min && c.age <= bucket.max)
    if (candidates.length === 0) continue

    // 同一個區間裡有好幾篇時，挑最接近理想間隔的那篇
    candidates.sort(
      (a, b) => Math.abs(a.age - bucket.target) - Math.abs(b.age - bucket.target),
    )
    const best = candidates[0]
    used.add(best.task.id)
    picks.push({ task: best.task, label: bucket.label, daysAgo: best.age })
  }

  return picks
}

// ---------------- 今天已重聽哪些（localStorage，換日自動失效） ----------------

const REVIEWED_KEY = 'lgl.relistened'

interface ReviewedRecord {
  date: string
  ids: string[]
}

export function loadReviewedToday(now: Date): Set<string> {
  try {
    const raw = localStorage.getItem(REVIEWED_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as ReviewedRecord
    // 換日就整包丟掉，不必自己清理過期資料
    if (parsed.date !== localDateKey(now)) return new Set()
    return new Set(Array.isArray(parsed.ids) ? parsed.ids : [])
  } catch {
    // localStorage 不可用或內容壞掉，當作今天還沒複習過
    return new Set()
  }
}

export function markReviewed(taskId: string, now: Date): void {
  try {
    const current = loadReviewedToday(now)
    current.add(taskId)
    const record: ReviewedRecord = { date: localDateKey(now), ids: [...current] }
    localStorage.setItem(REVIEWED_KEY, JSON.stringify(record))
  } catch {
    // 存不起來就只在本次瀏覽有效，不影響複習本身
  }
}
