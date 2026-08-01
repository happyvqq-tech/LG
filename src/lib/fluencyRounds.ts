// 流利度訓練（4/3/2 技巧）的純邏輯——方便單元測試
//
// 這是 Nation 四股（four strands）裡唯一還沒被覆蓋的那一股。目前的 App 有：
//   meaning-focused input（聽、讀）、meaning-focused output（說、寫）、
//   language-focused learning（文法點、單字、錯誤庫）
// 但完全沒有 fluency development。
//
// 流利度訓練的定義很嚴格：**用已經會的東西做到快，不學任何新東西**。
// 學習者「知道但講不出來」不是知識問題，是提取速度問題，而提取速度只能靠
// 重複同一份內容加速練出來——學新單字新文法完全不會改善它。
//
// 4/3/2 的原理：同一個話題連講三次，時間一次比一次短。內容已經想過了，
// 剩下的認知資源全部拿去加快提取。這也是最容易被跳過的一股，
// 因為它主觀上「感覺沒學到新東西」——但它正是把知識轉成能力的那一步。

import type { Language } from './types'

export interface FluencyRound {
  /** 第幾輪（1-3） */
  index: number
  seconds: number
  hint: string
}

/**
 * 原始的 4/3/2 是 4 分鐘 → 3 分鐘 → 2 分鐘。這裡等比例縮一半。
 *
 * 為什麼縮：B1 學習者要連續講 4 分鐘外語幾乎不可能，會變成大量沉默；
 * 而縮短之後比例仍是 4:3:2，時間壓力這個真正的活性成分完全保留。
 * 全程 4.5 分鐘，放得進「額外練習」而不會排擠掉每日任務。
 */
export const FLUENCY_ROUNDS: FluencyRound[] = [
  { index: 1, seconds: 120, hint: '第一次講，慢慢想沒關係，先把要講的內容講完整' },
  { index: 2, seconds: 90, hint: '同樣的內容再講一次。這次不用想內容了，專心講順' },
  { index: 3, seconds: 60, hint: '最後一次，時間剩一半。講不完沒關係，重點是講得比剛才快' },
]

/**
 * 計算字數。日文沒有分詞空白只能算字，中文同理；
 * 英文與韓文（有띄어쓰기）用空白切詞。
 *
 * 這個數字只用來跟「同一個人的前一輪」比較，跨語言的絕對值沒有可比性。
 */
export function countWords(text: string, language: Language): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  if (language === '日文' || language === '古文' || language === '台語') {
    // 標點不算字
    return Array.from(trimmed.replace(/[\s。、！？「」『』，,.!?]/g, '')).length
  }
  return trimmed.split(/\s+/).filter(Boolean).length
}

/** 每分鐘字數——流利度提升與否就看這個數字有沒有往上走 */
export function wordsPerMinute(words: number, seconds: number): number {
  if (seconds <= 0) return 0
  return Math.round((words / seconds) * 60)
}

export interface RoundResult {
  round: number
  seconds: number
  words: number
  wpm: number
}

/**
 * 三輪跑完的結論：最後一輪比第一輪快多少（百分比）。
 * 回 null 代表資料不足以比較（第一輪根本沒講出東西）。
 */
export function speedGain(results: RoundResult[]): number | null {
  const first = results[0]
  const last = results[results.length - 1]
  if (!first || !last || first.wpm <= 0) return null
  return Math.round(((last.wpm - first.wpm) / first.wpm) * 100)
}
