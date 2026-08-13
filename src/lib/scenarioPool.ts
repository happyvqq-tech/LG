// 情境挑選——純函式，可獨立測試
//
// 原本情境只從成員設定的六個類別（校園／日常／旅遊／職場／新聞時事／科技）
// 隨機挑一個。那六個都是「順利的日常」，但真實的語言能力從來不是在順利的
// 場合被考驗的——會點餐不代表能處理送錯餐，會自我介紹不代表能拒絕邀約。
//
// 所以偶爾（預設 15%）插入一個「意料之外」的情境。頻率刻意壓低：
// 這種情境的認知負荷高，每次都來會很累；偶爾出現才有「今天不一樣」的效果。

/**
 * 驚喜情境。共同點是都有社交摩擦或時間壓力——
 * 需要協商、拒絕、道歉、堅持立場，而不只是交換資訊。
 */
export const SURPRISE_SCENARIOS = [
  '東西送錯了要退換，但店員一直說是你的問題',
  '跟朋友起了小爭執，最後要把話講開',
  '在市場殺價，攤販不肯讓步',
  '臨時要拒絕一個不太好拒絕的邀約',
  '掛號看急診，要跟護理師描述症狀',
  '面試被追問一個你答不太出來的問題',
  '遲到了要跟對方道歉並解釋原因',
  '網路訂的東西沒收到，打電話客訴',
  '幫聽不懂的家人當翻譯，兩邊來回轉述',
  '跟房東反映房子的問題，對方推託',
] as const

/** 驚喜情境出現的機率 */
export const SURPRISE_RATE = 0.15

/**
 * 挑這次任務的情境。
 *
 * roll 由呼叫端傳進來（Math.random()），讓這個函式保持純粹、可測試——
 * 測試時給定 roll 就能確定拿到哪一種，不用去 mock 全域的亂數。
 */
export function pickScenario(
  pool: string[],
  roll: number,
  pick: number,
): { scenario: string; surprise: boolean } {
  const clamped = Number.isFinite(roll) ? Math.min(Math.max(roll, 0), 0.999999) : 0.5
  const index = Number.isFinite(pick) ? Math.min(Math.max(pick, 0), 0.999999) : 0

  if (clamped < SURPRISE_RATE) {
    return {
      scenario: SURPRISE_SCENARIOS[Math.floor(index * SURPRISE_SCENARIOS.length)],
      surprise: true,
    }
  }

  const usable = pool.length > 0 ? pool : ['日常']
  return { scenario: usable[Math.floor(index * usable.length)], surprise: false }
}
