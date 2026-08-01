// 跟讀朗讀評分——純函式，方便單元測試
//
// 設計限制：不串發音評測 API（CLAUDE.md 第 10 節，使用者 2026-08 決定不做），
// 拿不到真正的音高／音素分析。這裡用拿得到的三個訊號做近似：
// 1. 文字吻合度：辨識出的逐字稿跟目標句有多接近（唸錯字、漏字會反映在這裡）
// 2. 節奏接近度：跟讀花的時間跟 AI 剛剛唸這句的時間差多少（太快太慢都扣分，
//    抓的是「跟上 AI 的節奏」而非真正的音調高低）。走雲端語音時這個時間是從
//    音檔長度換算的，準確；走瀏覽器語音時只能量 wall clock，比較毛躁
// 3. 辨識信心值：SpeechRecognition 若有回傳 confidence 就納入；沒有（多數瀏覽器
//    回 0）就不計，把權重讓給前兩項，避免用一個不可靠的訊號拉低分數
//
// 這不是聲學層級的發音評分，UI 文案必須誠實呈現，不能宣稱「AI 聽出你的語調」。

function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,!?;:"'’‘“”()—–\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function levenshteinWords(a: string[], b: string[]): number {
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = curr
  }
  return prev[b.length]
}

/** 逐字稿跟目標句的詞級吻合度，0~1（以目標句詞數為基準，抓不到目標句時給 0） */
export function wordSimilarity(target: string, recognized: string): number {
  const a = normalizeForCompare(target).split(' ').filter(Boolean)
  const b = normalizeForCompare(recognized).split(' ').filter(Boolean)
  if (a.length === 0) return b.length === 0 ? 1 : 0
  const dist = levenshteinWords(a, b)
  return Math.max(0, 1 - dist / a.length)
}

/** 唸的時間跟 AI 剛剛唸這句的時間比較，0~1（比例在 0.7x~1.4x 內給滿分附近，越偏越扣分） */
export function timingCloseness(aiDurationMs: number, userDurationMs: number): number {
  if (aiDurationMs <= 0 || userDurationMs <= 0) return 0.5 // 沒量到時間就給中性分數，不讓它主導結果
  const ratio = userDurationMs / aiDurationMs
  const logDeviation = Math.abs(Math.log(ratio)) / Math.log(2) // ratio=2 或 0.5 時 = 1
  return Math.max(0, 1 - logDeviation)
}

export interface ShadowScoreInput {
  targetText: string
  recognizedText: string
  /** 0~1；瀏覽器沒回傳或不支援時傳 0 */
  confidence: number
  aiDurationMs: number
  userDurationMs: number
}

export interface ShadowScoreResult {
  /** 0~100，供 UI 顯示與 80 分門檻判斷 */
  score: number
  textAccuracy: number
  timing: number
}

const PASS_THRESHOLD = 80

export function computeShadowScore(input: ShadowScoreInput): ShadowScoreResult {
  const textAccuracy = wordSimilarity(input.targetText, input.recognizedText)
  const timing = timingCloseness(input.aiDurationMs, input.userDurationMs)
  const hasConfidence = input.confidence > 0
  const composite = hasConfidence
    ? textAccuracy * 0.6 + timing * 0.25 + input.confidence * 0.15
    : textAccuracy * 0.75 + timing * 0.25
  return { score: Math.round(composite * 100), textAccuracy, timing }
}

export function passesShadowScore(score: number): boolean {
  return score >= PASS_THRESHOLD
}

export { PASS_THRESHOLD as SHADOW_PASS_THRESHOLD }
