// 進步存摺的純計算邏輯——不依賴 Supabase，可獨立測試
//
// 為什麼要有這一頁：語言學習最大的流失原因是「感覺不到自己在進步」。
// 每天做完任務、複習完單字，畫面就結束了，努力沒有被累積成一個看得見的東西。
// 而這個 App 的資料庫其實已經躺著完整的證據——errors 有攻克紀錄、
// vocab_cards 有量的成長、activity_log 有練習天數、vocab_quizzes 有答對率——
// 只是從來沒有人把它們攤開來給使用者看。
//
// 呈現原則：
//   1. 一律「對照」而非單一數字。「這個月 18 天」沒有意義，
//      「這個月 18 天，比上個月多 4 天」才有。
//   2. 累積量要像存摺餘額一樣只增不減——那是最強的沉沒成本，
//      也是唯一一個「今天沒做也不會消失」的數字（連續天數會斷，這個不會）。
//   3. 不美化數字。退步就顯示退步，假的鼓勵會讓所有數字失去可信度。

import { toDateString, addDays, parseDateString } from './srs'

/** 比較週期長度：30 天。用「近 30 天 vs 前 30 天」而不是自然月，
 *  自然月會讓月初的人永遠看到一個很醜的數字，而那只是因為月才剛開始 */
export const PERIOD_DAYS = 30

export interface ProgressRaw {
  /** activity_log 的日期，'YYYY-MM-DD' */
  activityDates: string[]
  /** 每張單字卡的建立時間（ISO），用來畫累積成長曲線 */
  vocabCreatedAt: string[]
  quizzes: Array<{ quiz_date: string; score: number; total: number }>
  /** 已完成任務的 completed_at（ISO） */
  taskCompletedAt: string[]
  errors: Array<{
    created_at: string
    /** 攻克時間。migration-011 之前的資料是 null，計期間差時會被略過 */
    resolved_at: string | null
    status: string
    error_type: string
    language: string
  }>
}

export const EMPTY_RAW: ProgressRaw = {
  activityDates: [],
  vocabCreatedAt: [],
  quizzes: [],
  taskCompletedAt: [],
  errors: [],
}

/** 一個指標的本期／前期對照 */
export interface Metric {
  key: string
  label: string
  /** 本期數值 */
  value: number
  /** 前期數值 */
  prev: number
  /** 顯示單位（'' / '天' / '%'） */
  unit: string
  /** 數字變大是好事嗎——決定箭頭的顏色 */
  upIsGood: boolean
  /** 前期完全沒有資料（第一次使用），此時不該顯示「成長 100%」這種假訊號 */
  noBaseline: boolean
}

export interface Totals {
  /** 累積學習天數（抓取範圍內） */
  days: number
  /** 累積單字量 */
  vocab: number
  /** 累積攻克錯誤數 */
  resolved: number
  /** 累積完成任務數 */
  tasks: number
  /** 第一次有活動的日期，'YYYY-MM-DD'；完全沒資料時為 null */
  since: string | null
}

/** 把 ISO 時間字串轉成本地日期字串；壞資料回 null 而不是丟例外 */
function isoToDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : toDateString(d)
}

/** [from, to] 皆含，日期字串直接比大小即可（YYYY-MM-DD 字典序＝時序） */
function inRange(date: string | null, from: string, to: string): boolean {
  return date !== null && date >= from && date <= to
}

export interface Periods {
  thisFrom: string
  thisTo: string
  prevFrom: string
  prevTo: string
}

/** 近 30 天與其前一個 30 天的邊界 */
export function periodBounds(now: Date): Periods {
  return {
    thisTo: toDateString(now),
    thisFrom: toDateString(addDays(now, -(PERIOD_DAYS - 1))),
    prevTo: toDateString(addDays(now, -PERIOD_DAYS)),
    prevFrom: toDateString(addDays(now, -(PERIOD_DAYS * 2 - 1))),
  }
}

function countIn(dates: Array<string | null>, from: string, to: string): number {
  return dates.filter((d) => inRange(d, from, to)).length
}

/** 測驗答對率（0-100），該期間沒有測驗時回 null */
function accuracy(
  quizzes: ProgressRaw['quizzes'],
  from: string,
  to: string,
): number | null {
  const rows = quizzes.filter((q) => inRange(q.quiz_date, from, to))
  const total = rows.reduce((s, q) => s + q.total, 0)
  if (total === 0) return null
  const score = rows.reduce((s, q) => s + q.score, 0)
  return Math.round((score / total) * 100)
}

/**
 * 本期 vs 前期的五個指標。
 *
 * 刻意不放「新增錯誤數」：那個數字受寫作量影響太大，寫得多錯得多，
 * 減少可能只是因為這個月少寫了幾篇。拿一個會誤導人的數字當成長指標，
 * 比不放還糟。錯誤的資訊放在「最常犯的錯」那一區，用類別排名呈現。
 */
export function computeMetrics(raw: ProgressRaw, now: Date): Metric[] {
  const p = periodBounds(now)

  const vocabDates = raw.vocabCreatedAt.map(isoToDate)
  const taskDates = raw.taskCompletedAt.map(isoToDate)
  const resolvedDates = raw.errors.map((e) => isoToDate(e.resolved_at))

  const thisAcc = accuracy(raw.quizzes, p.thisFrom, p.thisTo)
  const prevAcc = accuracy(raw.quizzes, p.prevFrom, p.prevTo)

  const metrics: Metric[] = [
    {
      key: 'days',
      label: '練習天數',
      value: countIn(raw.activityDates, p.thisFrom, p.thisTo),
      prev: countIn(raw.activityDates, p.prevFrom, p.prevTo),
      unit: '天',
      upIsGood: true,
      noBaseline: false,
    },
    {
      key: 'tasks',
      label: '完成任務',
      value: countIn(taskDates, p.thisFrom, p.thisTo),
      prev: countIn(taskDates, p.prevFrom, p.prevTo),
      unit: '',
      upIsGood: true,
      noBaseline: false,
    },
    {
      key: 'vocab',
      label: '新學單字',
      value: countIn(vocabDates, p.thisFrom, p.thisTo),
      prev: countIn(vocabDates, p.prevFrom, p.prevTo),
      unit: '',
      upIsGood: true,
      noBaseline: false,
    },
    {
      key: 'resolved',
      label: '攻克錯誤',
      value: countIn(resolvedDates, p.thisFrom, p.thisTo),
      prev: countIn(resolvedDates, p.prevFrom, p.prevTo),
      unit: '',
      upIsGood: true,
      noBaseline: false,
    },
    {
      key: 'accuracy',
      label: '測驗答對率',
      value: thisAcc ?? 0,
      prev: prevAcc ?? 0,
      unit: '%',
      upIsGood: true,
      // 沒考過就沒有基準，顯示「—」而不是「跟上期一樣」
      noBaseline: prevAcc === null,
    },
  ]

  // 前期整段沒有任何紀錄＝這個人才剛開始用，所有「比上期」都是假的對照
  const noHistory =
    countIn(raw.activityDates, p.prevFrom, p.prevTo) === 0 &&
    countIn(taskDates, p.prevFrom, p.prevTo) === 0 &&
    countIn(vocabDates, p.prevFrom, p.prevTo) === 0
  if (noHistory) return metrics.map((m) => ({ ...m, noBaseline: true }))

  return metrics
}

/** 累積總量——存摺餘額，只增不減 */
export function computeTotals(raw: ProgressRaw): Totals {
  const days = new Set(raw.activityDates).size
  const resolved = raw.errors.filter((e) => e.status === 'resolved').length
  const since = raw.activityDates.length > 0 ? [...raw.activityDates].sort()[0] : null
  return { days, vocab: raw.vocabCreatedAt.length, resolved, tasks: raw.taskCompletedAt.length, since }
}

export interface GrowthPoint {
  /** 'YYYY-MM' */
  month: string
  /** 該月月底時的累積單字量 */
  cumulative: number
  /** 該月新增量 */
  added: number
}

/**
 * 單字量的累積成長曲線（近 months 個月，含本月）。
 * 用累積而非每月新增：累積線只會往上，看起來就是在存錢；
 * 每月新增會忽高忽低，忙碌的月份看起來像退步，但單字其實一個都沒少。
 */
export function buildGrowth(raw: ProgressRaw, now: Date, months = 6): GrowthPoint[] {
  const dates = raw.vocabCreatedAt.map(isoToDate).filter((d): d is string => d !== null).sort()

  const buckets: GrowthPoint[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    buckets.push({ month, cumulative: 0, added: 0 })
  }

  const first = buckets[0]?.month ?? ''
  for (const d of dates) {
    const m = d.slice(0, 7)
    // 區間之前建立的字仍算進累積基數，只是不計入任何一個月的新增
    if (m < first) {
      for (const b of buckets) b.cumulative++
      continue
    }
    const idx = buckets.findIndex((b) => b.month === m)
    if (idx < 0) continue // 未來日期（資料異常），忽略
    buckets[idx].added++
    for (let i = idx; i < buckets.length; i++) buckets[i].cumulative++
  }
  return buckets
}

/** 熱力圖的一格 */
export interface HeatCell {
  date: string
  /** 0＝沒練　1＝有練　2＝兩種模組　3＝三種以上 */
  level: 0 | 1 | 2 | 3
}

/**
 * 練習足跡熱力圖（近 weeks 週，每欄一週，週日起算）。
 *
 * activity_log 只記「這天有沒有練」，是布林值，畫出來會是兩階的黑白格。
 * 所以強度改由「當天碰了幾種模組」推導（完成任務／做測驗／學新單字），
 * 這樣格子的深淺才真的對應到投入程度，而不是只有有無。
 */
export function buildHeatmap(raw: ProgressRaw, now: Date, weeks = 12): HeatCell[][] {
  const active = new Set(raw.activityDates)
  const taskDays = new Set(raw.taskCompletedAt.map(isoToDate).filter(Boolean) as string[])
  const quizDays = new Set(raw.quizzes.map((q) => q.quiz_date))
  const vocabDays = new Set(raw.vocabCreatedAt.map(isoToDate).filter(Boolean) as string[])

  // 最後一欄是本週：往回推到本週日，再往前 weeks-1 週
  const startOfThisWeek = addDays(now, -now.getDay())
  const start = addDays(startOfThisWeek, -(weeks - 1) * 7)

  const grid: HeatCell[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const date = toDateString(addDays(start, w * 7 + d))
      const kinds = (taskDays.has(date) ? 1 : 0) + (quizDays.has(date) ? 1 : 0) + (vocabDays.has(date) ? 1 : 0)
      const level: HeatCell['level'] = !active.has(date) && kinds === 0 ? 0 : kinds >= 3 ? 3 : kinds === 2 ? 2 : 1
      col.push({ date, level })
    }
    grid.push(col)
  }
  return grid
}

export interface ErrorTypeRank {
  type: string
  language: string
  count: number
  /** 前期同類別的次數，用來標「變多了／變少了」 */
  prev: number
}

/**
 * 本期最常犯的錯誤類別（依 errors.created_at 計期）。
 * 附上前期次數是重點：知道「介系詞」錯 5 次沒什麼用，
 * 知道「介系詞從 9 次降到 5 次」才知道自己在哪裡真的變強了。
 */
export function rankErrorTypes(raw: ProgressRaw, now: Date, top = 5): ErrorTypeRank[] {
  const p = periodBounds(now)
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)

  const cur = new Map<string, number>()
  const prev = new Map<string, number>()
  for (const e of raw.errors) {
    const d = isoToDate(e.created_at)
    const key = `${e.language} ${e.error_type}`
    if (inRange(d, p.thisFrom, p.thisTo)) bump(cur, key)
    else if (inRange(d, p.prevFrom, p.prevTo)) bump(prev, key)
  }

  return [...cur.entries()]
    .map(([key, count]) => {
      const [language, type] = key.split(' ')
      return { type, language, count, prev: prev.get(key) ?? 0 }
    })
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    .slice(0, top)
}

export interface Milestone {
  track: string
  label: string
  /** 目前數值 */
  current: number
  /** 這一階的門檻 */
  target: number
  done: boolean
}

const LADDERS: Array<{ track: string; unit: string; steps: number[] }> = [
  { track: '學習天數', unit: '天', steps: [7, 30, 100, 365] },
  { track: '單字量', unit: '字', steps: [100, 300, 1000, 3000] },
  { track: '攻克錯誤', unit: '個', steps: [1, 10, 30, 100] },
  { track: '完成任務', unit: '份', steps: [10, 50, 150, 500] },
]

/**
 * 每條軌道回傳「下一個還沒達成的門檻」；全部達成就回傳最後一階（標為完成）。
 * 只顯示下一階而不是列出全部：一次看到四個伸手可及的目標會想去搆，
 * 看到十六個大部分做不到的目標只會覺得路很長。
 */
export function computeMilestones(t: Totals): Milestone[] {
  const values: Record<string, number> = {
    學習天數: t.days,
    單字量: t.vocab,
    攻克錯誤: t.resolved,
    完成任務: t.tasks,
  }
  return LADDERS.map(({ track, unit, steps }) => {
    const current = values[track] ?? 0
    const next = steps.find((s) => current < s)
    const target = next ?? steps[steps.length - 1]
    return { track, label: `${target} ${unit}`, current, target, done: next === undefined }
  })
}

/**
 * 一句話講出這個月最值得說嘴的事。
 * 沒有值得說的就誠實說沒有——每個月都硬擠一句好話，好話就不值錢了。
 */
export function highlightLine(metrics: Metric[], totals: Totals): string {
  const get = (k: string) => metrics.find((m) => m.key === k)
  const resolved = get('resolved')
  const days = get('days')
  const vocab = get('vocab')

  if (resolved && resolved.value > 0) {
    return `這個月修掉了 ${resolved.value} 個長期錯誤——那是真的攻克，不是碰巧沒犯。`
  }
  if (days && !days.noBaseline && days.value > days.prev) {
    return `這個月練了 ${days.value} 天，比上個月多 ${days.value - days.prev} 天。`
  }
  if (vocab && vocab.value > 0) {
    return `這個月新學了 ${vocab.value} 個單字，累積來到 ${totals.vocab} 個。`
  }
  if (totals.days > 0) {
    return `累積練了 ${totals.days} 天。這個月還沒開始也沒關係，做一次就接得回去。`
  }
  return '還沒有紀錄。做完第一次練習，這裡就會開始長出東西。'
}

/** 'YYYY-MM' → '8月'，圖表軸標籤用 */
export function monthLabel(month: string): string {
  return `${Number(month.slice(5, 7))}月`
}

/** 'YYYY-MM-DD' → '8/13' */
export function shortDate(date: string): string {
  const d = parseDateString(date)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
