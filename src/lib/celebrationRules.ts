// 任務完成結算的純邏輯——決定「這次最值得說的是哪件事」
//
// 為什麼要有這一步：完成任務的那一瞬間是整個流程情緒最高的時刻，
// 而原本的做法是直接 navigate('/home')——什麼都沒發生。行為設計上這是
// 最貴的浪費：收割成就感的成本幾乎是零，效果卻直接對應到「明天還想不想再來」。
//
// 但慶祝要挑重點。把「6 個語塊、3 個單字、4 個修正、連續 7 天」通通用同樣的
// 大小丟出來，等於沒有重點，讀的人不知道自己該為什麼高興。所以這裡排一個
// 優先序，只讓最強的那件事當主標，其餘退為附註。

import type { ErrorRecord } from './types'

/** 連續天數的里程碑。前面密一點（新手需要早一點嘗到甜頭），後面才拉開 */
const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 200, 365]

export interface CelebrationData {
  scenarioTitle: string
  /** logActivity 之前的連續天數 */
  streakBefore: number
  /** logActivity 之後的連續天數 */
  streakAfter: number
  /** 這次真的推進到 resolved 的錯誤 */
  resolvedErrors: ErrorRecord[]
  chunkCount: number
  /** 實際寫進單字庫的張數 */
  vocabAdded: number
  /** 本次批改抓到並修正的錯誤數 */
  fixedErrorCount: number
}

export type CelebrationTone = 'resolved' | 'milestone' | 'streak' | 'plain'

export interface CelebrationView {
  tone: CelebrationTone
  emoji: string
  headline: string
  sub: string
  /** 這次剛好達成的連續天數里程碑，沒有就是 null */
  streakMilestone: number | null
  /** 今天是不是第一次有活動紀錄（連續天數真的 +1） */
  streakGained: boolean
}

/** 剛好踩到里程碑才回傳；連續 8 天不會一直跳「7 天達成」 */
export function hitStreakMilestone(before: number, after: number): number | null {
  const hit = STREAK_MILESTONES.filter((m) => m > before && m <= after)
  return hit.length > 0 ? hit[hit.length - 1] : null
}

/**
 * 主標優先序：
 *   1. 攻克長期錯誤——這是最難、最真實的進步，一定排第一
 *   2. 踩到連續天數里程碑
 *   3. 連續天數 +1
 *   4. 都沒有就好好說一句話，不要硬擠激昂的形容詞
 */
export function buildCelebration(d: CelebrationData): CelebrationView {
  const milestone = hitStreakMilestone(d.streakBefore, d.streakAfter)
  const streakGained = d.streakAfter > d.streakBefore

  if (d.resolvedErrors.length > 0) {
    const n = d.resolvedErrors.length
    return {
      tone: 'resolved',
      emoji: '🎯',
      headline: `攻克了 ${n} 個長期錯誤`,
      // 講清楚「為什麼這值得高興」，不然使用者不知道這跟「這次沒錯」差在哪
      sub: '連續兩次有機會犯卻沒犯，再通過一次刻意設計的驗證——這是真的學會了，不是碰巧。',
      streakMilestone: milestone,
      streakGained,
    }
  }

  if (milestone !== null) {
    return {
      tone: 'milestone',
      emoji: '🏅',
      headline: `連續 ${milestone} 天`,
      sub: '維持頻率比單次練多久重要得多。這個數字是你自己一天一天疊起來的。',
      streakMilestone: milestone,
      streakGained,
    }
  }

  if (streakGained) {
    return {
      tone: 'streak',
      emoji: '🔥',
      headline: `連續 ${d.streakAfter} 天`,
      sub: '今天也接上了。',
      streakMilestone: null,
      streakGained,
    }
  }

  return {
    tone: 'plain',
    emoji: '✅',
    headline: '任務完成',
    sub: d.fixedErrorCount > 0 ? `修正了 ${d.fixedErrorCount} 個錯誤，都進了錯誤庫等著複習。` : '這次沒有新錯誤。',
    streakMilestone: null,
    streakGained,
  }
}

/** 底部那排小字：只列真的大於零的項目，不要出現「0 個單字入庫」 */
export function summaryParts(d: CelebrationData): string[] {
  const parts: string[] = []
  if (d.chunkCount > 0) parts.push(`${d.chunkCount} 個語塊`)
  if (d.vocabAdded > 0) parts.push(`${d.vocabAdded} 個單字入庫`)
  if (d.fixedErrorCount > 0) parts.push(`修正 ${d.fixedErrorCount} 個錯誤`)
  return parts
}
