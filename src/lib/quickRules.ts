// 「今天只有 5 分鐘」的排程邏輯——純函式，可獨立測試
//
// 為什麼需要這個模式：連續天數斷掉，很少是因為不想學，
// 而是「今天真的沒空做完整任務」→ 乾脆跳過 → 隔天發現斷了 → 就放棄了。
// 中間缺的是一個台階：忙的日子也有一個五分鐘做得完、而且真的算數的選項。
//
// 內容全部來自「已經到期、本來就該複習」的東西，不生成新教材：
//   1. 到期單字——SRS 說今天不複習就會忘，時效性最強，優先權最高
//   2. 錯誤庫裡的舊錯——重看一次「我以前這樣寫」，成本極低
//   3. 舊教材的句子——重聽的邊際成本幾乎是零（音檔還在快取裡）
// 所以這個模式完全不呼叫 AI，也不會多花任何 API 費用。

import type { ErrorRecord, Language, VocabCard } from './types'

/** 預設預算：5 分鐘 */
export const QUICK_BUDGET_SECONDS = 300

/**
 * 每種卡的預估秒數。抓得偏保守（寧可提早做完，不要超時）——
 * 承諾五分鐘卻做了八分鐘，下次就不會有人相信這個入口了。
 */
const SECONDS = { vocab: 20, error: 25, listen: 30 } as const

/** 每種來源的張數上限：五分鐘的重點是「有做」，不是把錯誤庫掃完 */
const MAX = { vocab: 8, error: 4, listen: 3 } as const

/**
 * 取卡順序。兩張單字夾一題錯誤再夾一句聽力，比「先做完八張單字」耐做——
 * 同一種形式連續超過三次就會開始像在填表格。
 */
const PATTERN = ['vocab', 'vocab', 'error', 'listen'] as const

export interface ListenSentence {
  taskId: string
  title: string
  sentence: string
  language: Language
}

export interface QuickInput {
  vocab: VocabCard[]
  errors: ErrorRecord[]
  listen: ListenSentence[]
}

export type QuickItem =
  | { kind: 'vocab'; seconds: number; card: VocabCard }
  | { kind: 'error'; seconds: number; error: ErrorRecord }
  | { kind: 'listen'; seconds: number; listen: ListenSentence }

export interface QuickPlan {
  items: QuickItem[]
  /** 預估總秒數 */
  seconds: number
}

export const EMPTY_PLAN: QuickPlan = { items: [], seconds: 0 }

/**
 * 依預算排出這次的卡片。
 * 塞不進預算的就不塞——寧可只做三張也不要超時，
 * 「五分鐘」是對使用者的承諾，不是形容詞。
 */
export function buildQuickPlan(input: QuickInput, budget = QUICK_BUDGET_SECONDS): QuickPlan {
  const queues = {
    vocab: input.vocab.slice(0, MAX.vocab),
    error: input.errors.slice(0, MAX.error),
    listen: input.listen.slice(0, MAX.listen),
  }

  const items: QuickItem[] = []
  let seconds = 0
  let cursor = 0

  // 每種都空了就結束；PATTERN 走完一輪從頭再來
  while (queues.vocab.length > 0 || queues.error.length > 0 || queues.listen.length > 0) {
    const kind = PATTERN[cursor % PATTERN.length]
    cursor++

    const cost = SECONDS[kind]
    // 這種卡沒了就跳過，不要卡在原地；預算不夠也跳過，也許還塞得下便宜一點的
    if (queues[kind].length === 0 || seconds + cost > budget) {
      // 三種都塞不下了才是真的結束
      const cheapest = Math.min(
        ...(['vocab', 'error', 'listen'] as const).filter((k) => queues[k].length > 0).map((k) => SECONDS[k]),
      )
      if (!Number.isFinite(cheapest) || seconds + cheapest > budget) break
      continue
    }

    seconds += cost
    if (kind === 'vocab') items.push({ kind, seconds: cost, card: queues.vocab.shift() as VocabCard })
    else if (kind === 'error') items.push({ kind, seconds: cost, error: queues.error.shift() as ErrorRecord })
    else items.push({ kind, seconds: cost, listen: queues.listen.shift() as ListenSentence })
  }

  return { items, seconds }
}

/** 「約 4 分鐘」——給使用者看的估計，無條件進位到分鐘 */
export function minutesLabel(seconds: number): string {
  if (seconds <= 0) return '0 分鐘'
  return `約 ${Math.max(1, Math.ceil(seconds / 60))} 分鐘`
}

/** 這次做了哪幾種、各幾張，收尾畫面用 */
export function planBreakdown(items: QuickItem[]): string {
  const n = (k: QuickItem['kind']) => items.filter((i) => i.kind === k).length
  const parts: string[] = []
  if (n('vocab') > 0) parts.push(`${n('vocab')} 個單字`)
  if (n('error') > 0) parts.push(`${n('error')} 個舊錯`)
  if (n('listen') > 0) parts.push(`${n('listen')} 句重聽`)
  return parts.join('・')
}
