// 錯誤狀態機的純邏輯（不依賴 Supabase，可獨立測試）
// active →（連續 2 次任務未再犯）→ pending_verify →（埋設情境驗證通過）→ resolved
//                                              └（再犯）→ 退回 active、verify_count 歸零

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
 * - 既有 active（非本次新增）：未再犯 verify_count+1（≥2 → pending_verify）；再犯歸零
 * - 本任務埋設驗證的 pending_verify：未再犯 → resolved；再犯 → 退回 active、verify_count 歸零
 * - 未埋設的 pending_verify 不動
 */
export function computeErrorTransitions(
  existing: ErrorRecord[],
  currentErrors: Array<{ original: string; error_type: string }>,
  newIds: Set<string>,
  verifyIds: Set<string>,
): ErrorTransition[] {
  const updates: ErrorTransition[] = []

  for (const ex of existing) {
    if (newIds.has(ex.id)) continue // 本次剛寫入的新錯誤不參與比對
    const repeated = currentErrors.some((ge) => isSimilarError(ge, ex))

    if (ex.status === 'active') {
      if (repeated) {
        if (ex.verify_count !== 0) updates.push({ id: ex.id, patch: { verify_count: 0 } })
      } else {
        const count = ex.verify_count + 1
        updates.push({
          id: ex.id,
          patch: count >= 2 ? { verify_count: count, status: 'pending_verify' } : { verify_count: count },
        })
      }
    } else if (ex.status === 'pending_verify' && verifyIds.has(ex.id)) {
      updates.push({
        id: ex.id,
        patch: repeated ? { status: 'active', verify_count: 0 } : { status: 'resolved' },
      })
    }
  }

  return updates
}
