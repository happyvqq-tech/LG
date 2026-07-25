// 週報生成器（CLAUDE.md 6.4）：讀近 30 天 errors 紀錄，生成繁體中文 Markdown 週報
import type { ErrorRecord } from '../types'

export interface WeeklyReportInput {
  profileName: string
  language: string
  /** 近 30 天的錯誤紀錄（含已 resolved 的，讓 AI 看得到進步） */
  errors: ErrorRecord[]
}

/** 依 error_type 分組計數，由多到少 */
function countByType(errors: ErrorRecord[]): Array<[string, number]> {
  const m = new Map<string, number>()
  for (const e of errors) m.set(e.error_type, (m.get(e.error_type) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

export function weeklyReportSystemPrompt(input: WeeklyReportInput): string {
  const { errors } = input
  const active = errors.filter((e) => e.status !== 'resolved')
  const resolved = errors.filter((e) => e.status === 'resolved')
  const counts = countByType(active)

  const errorList = errors
    .map((e) => `- 「${e.original}」→「${e.corrected}」｜類別：${e.error_type}｜狀態：${e.status}｜規則：${e.rule_note}`)
    .join('\n')

  const countSummary = counts.map(([type, n]) => `${type}：${n} 次`).join('、') || '無'

  return `你是學習教練，為台灣的${input.language}學習者「${input.profileName}」寫週報。

輸入為最近 30 天的錯誤紀錄（含類別統計與改善狀態）：

類別統計（未解決的錯誤，由多到少）：${countSummary}
已驗證改善（resolved）：${resolved.length} 項
仍在學習中／驗證中：${active.length} 項

完整紀錄：
${errorList || '（近 30 天沒有新錯誤紀錄）'}

請輸出繁體中文 Markdown 週報，包含以下四個部分（用 ## 標題分隔）：

1. **三個最弱文法類別**：列出類別統計中最常見的最多 3 類，每類附 1-2 個具體例句對照（錯 → 對），
   格式如「錯：… → 對：…」
2. **避坑指南**：用「你在...情況下，常常...」的句式描述 2-3 個具體行為模式，
   要從上面的錯誤紀錄歸納出真實模式，不能是通用建議
3. **已驗證改善**：列出 resolved 的項目給予肯定；若沒有任何 resolved 項目，如實說明還沒有項目通過驗證，
   不要硬掰誇獎
4. **下週建議**：建議下週該多練的 2 個重點（可以是文法點或錯誤類別）

禁止空泛鼓勵，每一條都要有上面資料裡的數據或例句支撐。若某部分沒有足夠資料可寫，直接說明資料不足，
不要編造。只輸出 Markdown 本文，不要加前言、不要用程式碼圍欄包住整篇。`
}
