// 間隔重複排程（SM-2 改良版）——純函式，方便單元測試
//
// 設計要點：
// 1. stage 0-5 是「關卡進度」：初見 → 認詞 → 回想 → 聽辨 → 產出 → 已學會
//    答對才推進關卡，所以同一個字會在不同天以不同方式出現
// 2. interval/ease 是「什麼時候再出現」：答得越輕鬆，下次間隔拉越長
// 3. 忘記時退一關並縮短間隔，但 ease 不會無限下降（下限 1.3）

export const MAX_STAGE = 5

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export interface SrsState {
  stage: number
  ease: number
  intervalDays: number
  repetitions: number
  lapses: number
}

export const NEW_CARD: SrsState = {
  stage: 0,
  ease: 2.5,
  intervalDays: 0,
  repetitions: 0,
  lapses: 0,
}

const EASE_MIN = 1.3
const EASE_MAX = 2.8
const INTERVAL_MAX = 180

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

/** 依作答品質算出新的排程狀態 */
export function schedule(state: SrsState, grade: Grade): SrsState {
  const { ease, intervalDays, repetitions, stage, lapses } = state

  if (grade === 'again') {
    return {
      stage: Math.max(1, stage - 1), // 退一關，但不退回「初見」
      ease: clamp(ease - 0.2, EASE_MIN, EASE_MAX),
      intervalDays: 1,
      repetitions: 0,
      lapses: lapses + 1,
    }
  }

  let nextInterval: number
  if (grade === 'hard') {
    nextInterval = repetitions === 0 ? 1 : Math.max(1, Math.round(intervalDays * 1.2))
  } else if (repetitions === 0) {
    nextInterval = grade === 'easy' ? 3 : 1
  } else if (repetitions === 1) {
    nextInterval = grade === 'easy' ? 6 : 3
  } else {
    const multiplier = grade === 'easy' ? ease * 1.3 : ease
    nextInterval = Math.round(intervalDays * multiplier)
  }

  const easeDelta = grade === 'hard' ? -0.15 : grade === 'easy' ? 0.15 : 0
  // hard 不算真正記住，不推進關卡
  const stageDelta = grade === 'hard' ? 0 : 1

  return {
    stage: Math.min(MAX_STAGE, stage + stageDelta),
    ease: clamp(ease + easeDelta, EASE_MIN, EASE_MAX),
    intervalDays: clamp(nextInterval, 1, INTERVAL_MAX),
    repetitions: repetitions + 1,
    lapses,
  }
}

/** 以 YYYY-MM-DD 表示日期（配合 Postgres date 欄位，避免時區位移） */
export function toDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(from: Date, days: number): Date {
  const d = new Date(from)
  d.setDate(d.getDate() + days)
  return d
}

/**
 * 把 toDateString 產出的 'YYYY-MM-DD' 解析回 Date（本地時區午夜）。
 * 不可用 `new Date(str)`：那會以 UTC 午夜解析，在負時區（如美洲）會被
 * getDate() 讀成前一天，跟這裡其餘全以本地時間為準的函式互相打架。
 */
export function parseDateString(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 排程後的下次複習日 */
export function nextDueDate(state: SrsState, from = new Date()): string {
  return toDateString(addDays(from, state.intervalDays))
}

/** 每個關卡對應的練習方式 */
export type DrillMode = 'intro' | 'recognize' | 'recall' | 'listen' | 'produce'

export function modeForStage(stage: number): DrillMode {
  switch (stage) {
    case 0:
      return 'intro'
    case 1:
      return 'recognize'
    case 2:
      return 'recall'
    case 3:
      return 'listen'
    default:
      return 'produce'
  }
}

export const MODE_LABELS: Record<DrillMode, string> = {
  intro: '初見',
  recognize: '認詞',
  recall: '回想',
  listen: '聽辨',
  produce: '產出',
}
