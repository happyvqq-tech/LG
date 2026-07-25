// 句讀（斷句）練習——純函式，方便單元測試
//
// 傳統文言訓練的第一關就是句讀：給你一段沒有標點的原文，你要斷得出來。
// 這是最誠實的理解檢測——斷得對就是真懂，蒙不了。
// 韓愈〈師說〉：「彼童子之師，授之書而習其句讀者也。」

/** 視為斷句點的標點 */
const BREAK_MARKS = new Set(['，', '、', '。', '；', '：', '？', '！'])
/** 需要移除但不算斷句的符號（引號、括號等） */
const SKIP_MARKS = new Set(['「', '」', '『', '』', '（', '）', '〈', '〉', '《', '》', '“', '”', '‘', '’', ' ', '　'])

export interface PunctuationTask {
  /** 去掉所有標點後的連續原文 */
  plain: string
  /** 正確的斷句位置：在 plain 的第 i 個字之後斷（i 為 0-based 索引） */
  breaks: number[]
}

/**
 * 由有標點的原文產生句讀題。
 * 篇末的標點會產生一個落在最後一字之後的斷點，那不算考點，故排除。
 */
export function buildPunctuationTask(punctuated: string): PunctuationTask {
  let plain = ''
  const breaks: number[] = []

  for (const ch of punctuated) {
    if (BREAK_MARKS.has(ch)) {
      // 連續標點（如 」。）只記一次；文首標點沒有前字，忽略
      if (plain.length > 0) {
        const pos = plain.length - 1
        if (breaks[breaks.length - 1] !== pos) breaks.push(pos)
      }
      continue
    }
    if (SKIP_MARKS.has(ch)) continue
    plain += ch
  }

  // 最後一字之後必定是句末，不列入考點
  const last = plain.length - 1
  return { plain, breaks: breaks.filter((b) => b !== last) }
}

export interface PunctuationScore {
  /** 斷對的數量 */
  hit: number
  /** 該斷沒斷 */
  missed: number
  /** 不該斷卻斷了 */
  extra: number
  /** 正確率 0-1（F1，兼顧漏斷與亂斷） */
  f1: number
  /** 供逐點檢討：每個正確斷點使用者有沒有抓到 */
  hitPositions: number[]
  missedPositions: number[]
  extraPositions: number[]
}

/** 比對使用者的斷句與正確答案 */
export function scorePunctuation(userBreaks: number[], correct: number[]): PunctuationScore {
  const want = new Set(correct)
  const got = new Set(userBreaks)

  const hitPositions = correct.filter((p) => got.has(p))
  const missedPositions = correct.filter((p) => !got.has(p))
  const extraPositions = [...got].filter((p) => !want.has(p)).sort((a, b) => a - b)

  const hit = hitPositions.length
  const precision = got.size === 0 ? 0 : hit / got.size
  const recall = want.size === 0 ? 1 : hit / want.size
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)

  return {
    hit,
    missed: missedPositions.length,
    extra: extraPositions.length,
    f1,
    hitPositions,
    missedPositions,
    extraPositions,
  }
}

/** 依 F1 給評語，避免只丟一個冷冰冰的數字 */
export function punctuationComment(score: PunctuationScore): string {
  const pct = Math.round(score.f1 * 100)
  if (pct >= 95) return '幾乎全對，文氣抓得很準'
  if (pct >= 85) return '斷得不錯，少數幾處再留意虛詞落點'
  if (pct >= 70) return '大致成句，但有幾處把一句拆散或把兩句黏在一起'
  if (pct >= 50) return '句子邊界還不穩，建議先跟著朗讀找停頓感'
  return '先別急著斷，回去聽一次朗讀，感受語氣停頓在哪裡'
}

/**
 * 從段落取一段長度適中的原文來練句讀。
 * 長段落（本書最長的一段有四百多個斷點）整段做完會累垮人，
 * 故切到約 maxChars 字，且一定切在標點處，不會斷在句子中間。
 */
export function takeSegment(punctuated: string, maxChars = 80): string {
  if (punctuated.length <= maxChars) return punctuated

  let lastBreak = -1
  let plainCount = 0
  for (let i = 0; i < punctuated.length; i++) {
    const ch = punctuated[i]
    if (BREAK_MARKS.has(ch)) {
      lastBreak = i
      if (plainCount >= maxChars) return punctuated.slice(0, i + 1)
      continue
    }
    if (!SKIP_MARKS.has(ch)) plainCount++
  }
  // 整段都沒有夠靠後的標點時，退回最後一個標點處
  return lastBreak > 0 ? punctuated.slice(0, lastBreak + 1) : punctuated
}

/** 把原文依斷句位置切成短句，供檢討時逐句對照 */
export function splitByBreaks(plain: string, breaks: number[]): string[] {
  const sorted = [...new Set(breaks)].sort((a, b) => a - b)
  const out: string[] = []
  let start = 0
  for (const b of sorted) {
    if (b < start || b >= plain.length) continue
    out.push(plain.slice(start, b + 1))
    start = b + 1
  }
  if (start < plain.length) out.push(plain.slice(start))
  return out
}
