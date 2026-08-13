// 難度自動調節的建議邏輯——純函式，可獨立測試
//
// 為什麼需要：程度目前是註冊時手動選的，選完就不會再改。太簡單會無聊、
// 太難會挫折，兩邊都會流失，而學習者自己通常判斷不了——覺得「有點難」
// 到底是正常的學習張力，還是真的選錯級數，沒有基準可比。
//
// 但系統有基準：寫作錯誤密度與測驗答對率都是現成的客觀訊號。
//
// ── 一條原則：只建議，不自動改 ──────────────────────────────
// 程度是使用者對自己的認知，系統擅自把 B1 改成 B2，下次打開發現教材變難了
// 卻不知道為什麼，那是很糟的體驗。這裡只負責開口，決定權留給人。
// 而且開口時要講出憑據（「最近 6 篇平均只有 0.8 個錯誤」），
// 不是「系統建議您升級」這種沒有內容的話。

import { ALL_LEVELS, type Level } from './types'

/** 觀察窗：14 天。太短會被一兩篇的好壞帶著跑，太長則反映不出最近的進步 */
export const WINDOW_DAYS = 14

/** 要有幾筆才敢下結論。低於這個數字寧可不說話 */
const MIN_TASKS = 3
const MIN_QUIZZES = 3

/** 判準。刻意抓得保守——誤判升級會讓人挫折，誤判降級會讓人覺得被看扁 */
const EASY_ERRORS = 1.2
const EASY_ACCURACY = 88
const HARD_ERRORS = 5
const HARD_ACCURACY = 55

export interface Evidence {
  /** 這段期間有批改紀錄的任務數 */
  tasksGraded: number
  /** 每篇平均錯誤數；沒有資料為 null */
  avgErrors: number | null
  quizCount: number
  /** 測驗答對率 0-100；沒有資料為 null */
  accuracy: number | null
}

export const EMPTY_EVIDENCE: Evidence = {
  tasksGraded: 0,
  avgErrors: null,
  quizCount: 0,
  accuracy: null,
}

export type AdviceKind = 'up' | 'down' | 'stay' | 'insufficient'

export interface LevelAdvice {
  kind: AdviceKind
  from: Level
  /** 建議調到的程度；kind 不是 up/down 時為 null */
  to: Level | null
  /** 給使用者看的憑據，一定帶數字 */
  reason: string
}

function step(level: Level, delta: number): Level | null {
  const i = ALL_LEVELS.indexOf(level)
  const next = ALL_LEVELS[i + delta]
  return next ?? null
}

/** 把小數位收乾淨：0.8 而不是 0.7999999999 */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * 由證據產生建議。
 *
 * 兩個訊號互相矛盾時（例如寫作幾乎不錯、但測驗一直低分）一律回 stay：
 * 那通常代表某一邊的資料有問題，而不是程度有問題。矛盾時閉嘴，
 * 比丟一個站不住腳的建議出去好——建議只要錯一次，之後就不會有人理它。
 */
export function buildLevelAdvice(level: Level, ev: Evidence): LevelAdvice {
  const base = { from: level, to: null as Level | null }

  const hasTasks = ev.tasksGraded >= MIN_TASKS && ev.avgErrors !== null
  const hasQuizzes = ev.quizCount >= MIN_QUIZZES && ev.accuracy !== null
  if (!hasTasks && !hasQuizzes) {
    return {
      ...base,
      kind: 'insufficient',
      reason: `最近 ${WINDOW_DAYS} 天的紀錄還不夠下判斷，先多練幾次`,
    }
  }

  const easySignals: string[] = []
  const hardSignals: string[] = []

  if (hasTasks) {
    const avg = round1(ev.avgErrors as number)
    if (avg <= EASY_ERRORS) easySignals.push(`最近 ${ev.tasksGraded} 篇寫作平均只有 ${avg} 個錯誤`)
    if (avg >= HARD_ERRORS) hardSignals.push(`最近 ${ev.tasksGraded} 篇寫作平均有 ${avg} 個錯誤`)
  }
  if (hasQuizzes) {
    const acc = Math.round(ev.accuracy as number)
    if (acc >= EASY_ACCURACY) easySignals.push(`單字測驗答對率 ${acc}%`)
    if (acc <= HARD_ACCURACY) hardSignals.push(`單字測驗答對率只有 ${acc}%`)
  }

  const tooEasy = easySignals.length > 0
  const tooHard = hardSignals.length > 0

  // 一邊說太簡單、一邊說太難：資料在打架，不下結論
  if (tooEasy && tooHard) {
    return { ...base, kind: 'stay', reason: '訊號互相矛盾，維持目前程度比較保險' }
  }

  if (tooEasy) {
    const up = step(level, 1)
    if (up === null) {
      return { ...base, kind: 'stay', reason: `${easySignals.join('、')}——已經是最高級了，維持` }
    }
    return { from: level, to: up, kind: 'up', reason: easySignals.join('、') }
  }

  if (tooHard) {
    const down = step(level, -1)
    if (down === null) {
      return { ...base, kind: 'stay', reason: `${hardSignals.join('、')}——已經是最基礎的級數了，維持` }
    }
    return { from: level, to: down, kind: 'down', reason: hardSignals.join('、') }
  }

  const parts: string[] = []
  if (hasTasks) parts.push(`平均 ${round1(ev.avgErrors as number)} 個錯誤`)
  if (hasQuizzes) parts.push(`答對率 ${Math.round(ev.accuracy as number)}%`)
  return { ...base, kind: 'stay', reason: `${parts.join('、')}，難度剛好` }
}

// ---------------- 已讀不再問（localStorage） ----------------

const DISMISS_KEY = 'lgl.levelAdvice'

/** 按了「先維持」之後隔多久才可以再問。太快再問會變成騷擾 */
const SNOOZE_DAYS = 14

interface DismissRecord {
  /** 被關掉時的程度與方向，換了就重新評估 */
  level: Level
  kind: AdviceKind
  /** 這個時間之前不要再問（epoch ms） */
  until: number
}

export function dismissAdvice(advice: LevelAdvice, now = new Date()): void {
  try {
    const record: DismissRecord = {
      level: advice.from,
      kind: advice.kind,
      until: now.getTime() + SNOOZE_DAYS * 86400000,
    }
    localStorage.setItem(DISMISS_KEY, JSON.stringify(record))
  } catch {
    // 存不起來就只在本次瀏覽有效，不影響建議本身
  }
}

/** 這個建議現在該不該顯示 */
export function shouldShowAdvice(advice: LevelAdvice, now = new Date()): boolean {
  if (advice.kind !== 'up' && advice.kind !== 'down') return false
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    if (!raw) return true
    const r = JSON.parse(raw) as DismissRecord
    // 程度或方向變了就是新的建議，之前關掉的那個不算數
    if (r.level !== advice.from || r.kind !== advice.kind) return true
    return now.getTime() >= r.until
  } catch {
    return true
  }
}
