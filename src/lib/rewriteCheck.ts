// 重寫檢查：把重寫的版本跟這次批改出的錯誤逐條比對——純函式，方便單元測試
//
// 為什麼要有「重寫」這一步：書面糾錯回饋的研究（Bitchener、Ferris 等）結論
// 很一致——**回饋不搭配修改，效果接近零**。看懂 ≠ 會用。
//
// 原本的流程是「看批改 → 完成任務」，中間沒有任何輸出，錯誤修復整個押在
// errors 表上等下一個任務碰運氣重新遭遇。但那可能是三天後、情境完全不同，
// 那時要重新建立連結，成本高得多。趁工作記憶還熱的時候修一次，效率差好幾倍。

import type { GraderError, Language } from './types'

function normalize(s: string, language: Language): string {
  const lowered = s.toLowerCase().replace(/[.,!?;:'"()「」『』。、！？；：]/g, ' ')
  // 日文沒有分詞空白，連空白一起去掉才能做子字串比對；
  // 英韓保留單一空白，否則 "in time" 會誤判成 "intime" 的一部分
  if (language === '日文' || language === '古文' || language === '台語') {
    return lowered.replace(/\s+/g, '')
  }
  return lowered.replace(/\s+/g, ' ').trim()
}

export interface RewriteCheck {
  error: GraderError
  /** 原本的錯誤片段還在重寫版裡 */
  stillPresent: boolean
  /** 批改建議的說法出現在重寫版裡 */
  appliedFix: boolean
}

export type RewriteVerdict = 'fixed' | 'still-wrong' | 'avoided'

/**
 * 三種結果，刻意分開而不是只有對／錯：
 *   fixed       改成建議的說法了
 *   still-wrong 錯的片段還在
 *   avoided     兩者都不在——換句話說避開了。這不算失敗，但也不算證明會用，
 *               UI 要照實說，不要當成攻克
 */
export function verdictOf(check: RewriteCheck): RewriteVerdict {
  if (check.stillPresent) return 'still-wrong'
  if (check.appliedFix) return 'fixed'
  return 'avoided'
}

export function checkRewrite(
  rewrite: string,
  errors: GraderError[],
  language: Language,
): RewriteCheck[] {
  const text = normalize(rewrite, language)
  return errors.map((error) => {
    const wrong = normalize(error.original, language)
    const right = normalize(error.corrected, language)
    return {
      error,
      // 空字串會被 includes 判成 true，要擋掉，否則每一條都變成「還沒改」
      stillPresent: wrong.length > 0 && text.includes(wrong),
      appliedFix: right.length > 0 && text.includes(right),
    }
  })
}

/** 給 UI 的摘要：改掉幾條、還剩幾條 */
export function summarize(checks: RewriteCheck[]): {
  fixed: number
  stillWrong: number
  avoided: number
} {
  let fixed = 0
  let stillWrong = 0
  let avoided = 0
  for (const c of checks) {
    const v = verdictOf(c)
    if (v === 'fixed') fixed++
    else if (v === 'still-wrong') stillWrong++
    else avoided++
  }
  return { fixed, stillWrong, avoided }
}
