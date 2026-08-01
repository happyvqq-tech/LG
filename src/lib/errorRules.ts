// 錯誤狀態機的純邏輯（不依賴 Supabase，可獨立測試）
// active →（連續 2 次「有機會犯卻沒犯」）→ pending_verify →（埋設情境驗證通過）→ resolved
//                                                      └（再犯）→ 退回 active、verify_count 歸零
//
// 「有機會犯」是關鍵限定：任務生成時會為部分 active 錯誤刻意設計非用到該句型
// 不可的情境（exposure_error_ids）。只有這些才計數。
//
// 原本的規則是「這次任務沒再犯就 +1」，但沒再犯很可能只是任務根本沒用到那個
// 句型——那不是進步的證據，是沒被考到。累積下來會產生假陽性的 resolved：
// 學習者以為攻克了、系統也不再考他，那個錯誤就永久逃逸。錯誤狀態機是這個 App
// 最有價值的設計，它的信號品質決定一切，寧可慢一點也不能給錯的訊號。

import type { ErrorRecord } from './types'

function normalize(s: string): string {
  return s.toLowerCase().replace(/[.,!?;:'"()「」。、！？；：]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 同 error_type 且 original 相似（包含關係或字詞重疊 ≥ 0.5）視為同一個錯誤 */
export function isSimilarError(
  a: { original: string; error_type: string },
  b: { original: string; error_type: string },
): boolean {
  if (a.error_type !== b.error_type) return false
  const na = normalize(a.original)
  const nb = normalize(b.original)
  if (!na || !nb) return false
  if (na.includes(nb) || nb.includes(na)) return true
  const wa = new Set(na.split(' '))
  const wb = new Set(nb.split(' '))
  const inter = [...wa].filter((w) => wb.has(w)).length
  const union = new Set([...wa, ...wb]).size
  return union > 0 && inter / union >= 0.5
}

export interface ErrorTransition {
  id: string
  patch: Partial<Pick<ErrorRecord, 'status' | 'verify_count'>>
}

/**
 * 純函式：計算任務完成時的狀態機轉移。
 * - 既有 active（非本次新增）：
 *     再犯 → verify_count 歸零（不論這次有沒有刻意製造機會，犯了就是犯了）
 *     沒再犯且本任務有製造使用機會 → verify_count+1（≥2 → pending_verify）
 *     沒再犯但本任務沒製造機會 → 不動（沒被考到不算通過）
 * - 本任務埋設驗證的 pending_verify：未再犯 → resolved；再犯 → 退回 active、verify_count 歸零
 * - 未埋設的 pending_verify 不動
 */
export function computeErrorTransitions(
  existing: ErrorRecord[],
  currentErrors: Array<{ original: string; error_type: string }>,
  newIds: Set<string>,
  verifyIds: Set<string>,
  /** 本任務刻意製造了使用機會的 active 錯誤 id。舊任務沒有這個欄位，傳空集合即可 */
  exposureIds: Set<string> = new Set(),
): ErrorTransition[] {
  const updates: ErrorTransition[] = []

  for (const ex of existing) {
    if (newIds.has(ex.id)) continue // 本次剛寫入的新錯誤不參與比對
    const repeated = currentErrors.some((ge) => isSimilarError(ge, ex))

    if (ex.status === 'active') {
      if (repeated) {
        if (ex.verify_count !== 0) updates.push({ id: ex.id, patch: { verify_count: 0 } })
      } else if (exposureIds.has(ex.id)) {
        const count = ex.verify_count + 1
        updates.push({
          id: ex.id,
          patch: count >= 2 ? { verify_count: count, status: 'pending_verify' } : { verify_count: count },
        })
      }
      // 沒再犯又沒被製造機會：這次任務對這個錯誤沒有任何資訊，什麼都不做
    } else if (ex.status === 'pending_verify' && verifyIds.has(ex.id)) {
      updates.push({
        id: ex.id,
        patch: repeated ? { status: 'active', verify_count: 0 } : { status: 'resolved' },
      })
    }
  }

  return updates
}
