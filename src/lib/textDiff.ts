// 簡易字詞層級 diff（LCS），供批改結果「最小修改版 vs 母語自然版」高亮差異

import type { Language } from './types'

export interface DiffToken {
  text: string
  changed: boolean
}

function tokenize(text: string, language: Language): string[] {
  // 日文沒有分詞空白，只能逐字比對；韓文有分寫（띄어쓰기），
  // 跟英文一樣用空白切詞就對了
  if (language === '日文') return Array.from(text)
  return text.split(/(\s+)/).filter((t) => t.length > 0)
}

export function diffTokens(
  a: string,
  b: string,
  language: Language,
): { a: DiffToken[]; b: DiffToken[] } {
  const ta = tokenize(a, language)
  const tb = tokenize(b, language)
  const n = ta.length
  const m = tb.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ra: DiffToken[] = []
  const rb: DiffToken[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (ta[i] === tb[j]) {
      ra.push({ text: ta[i], changed: false })
      rb.push({ text: tb[j], changed: false })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ra.push({ text: ta[i], changed: true })
      i++
    } else {
      rb.push({ text: tb[j], changed: true })
      j++
    }
  }
  while (i < n) ra.push({ text: ta[i++], changed: true })
  while (j < m) rb.push({ text: tb[j++], changed: true })
  return { a: ra, b: rb }
}
