// 錯誤記憶庫的資料層：寫入新錯誤、於任務完成時套用狀態機（規則見 errorRules.ts）

import { supabase } from './supabase'
import { computeErrorTransitions, isSimilarError } from './errorRules'
import { updateTaskJson } from './taskService'
import type { ErrorRecord, GraderError, Task } from './types'

export { isSimilarError, computeErrorTransitions } from './errorRules'

async function fetchOpenErrors(profileId: string, language: string): Promise<ErrorRecord[]> {
  const { data, error } = await supabase
    .from('errors')
    .select('*')
    .eq('profile_id', profileId)
    .eq('language', language)
    .in('status', ['active', 'pending_verify'])
  if (error) throw new Error(error.message)
  return (data ?? []) as ErrorRecord[]
}

/**
 * 批改完成後呼叫：把本次新錯誤寫入 errors 表（status='active'）。
 * 與既有未解決錯誤相似者不重複建檔（由狀態機處理再犯）。
 * 重新批改時先刪除本任務先前寫入的錯誤再重寫，避免重複。
 */
export async function syncTaskErrors(task: Task, graderErrors: GraderError[]): Promise<Task> {
  const prevIds = task.task_json.inserted_error_ids ?? []
  if (prevIds.length > 0) {
    const { error } = await supabase.from('errors').delete().in('id', prevIds)
    if (error) throw new Error(error.message)
  }

  const existing = await fetchOpenErrors(task.profile_id, task.language)
  const toInsert = graderErrors.filter((ge) => !existing.some((ex) => isSimilarError(ge, ex)))

  let insertedIds: string[] = []
  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from('errors')
      .insert(
        toInsert.map((e) => ({
          profile_id: task.profile_id,
          language: task.language,
          original: e.original,
          corrected: e.corrected,
          error_type: e.error_type,
          rule_note: e.rule_note,
          status: 'active',
        })),
      )
      .select('id')
    if (error) throw new Error(error.message)
    insertedIds = (data ?? []).map((r) => (r as { id: string }).id)
  }

  return updateTaskJson(task, { inserted_error_ids: insertedIds })
}

/**
 * 任務完成時呼叫：讀取現況 → 計算轉移 → 寫回。
 *
 * 回傳「這次真的攻克掉的錯誤」。這是整個 App 最值得慶祝的事件——
 * 一個錯誤要連續兩次「有機會犯卻沒犯」才會進 pending_verify，
 * 再通過一次刻意埋設的驗證才會 resolved，是實打實的進步證據。
 * 以前這件事發生了卻沒人知道，狀態默默改掉、畫面跳回首頁。
 */
export async function processTaskCompletion(task: Task): Promise<ErrorRecord[]> {
  const currentErrors = task.task_json.grading?.errors ?? []
  const existing = await fetchOpenErrors(task.profile_id, task.language)
  const updates = computeErrorTransitions(
    existing,
    currentErrors,
    new Set(task.task_json.inserted_error_ids ?? []),
    new Set(task.task_json.verify_error_ids ?? []),
    // 這個欄位是後來才加的，本次改動之前生成的任務不會有——傳空集合，
    // 那些 active 錯誤就停在原地等下一個有製造機會的任務，不會被錯誤地推進
    new Set(task.task_json.exposure_error_ids ?? []),
  )
  for (const u of updates) {
    const { error } = await supabase.from('errors').update(u.patch).eq('id', u.id)
    if (error) throw new Error(error.message)
  }

  const resolvedIds = updates.filter((u) => u.patch.status === 'resolved').map((u) => u.id)
  await stampResolvedAt(resolvedIds)

  const byId = new Map(existing.map((e) => [e.id, e]))
  return resolvedIds.map((id) => byId.get(id)).filter((e): e is ErrorRecord => e !== undefined)
}

/**
 * 記錄「攻克時間」，給進步存摺算「這個月修掉幾個」用。
 *
 * 刻意跟上面的狀態機更新分開、而且失敗就算了：resolved_at 是 migration-011
 * 才加的欄位，還沒跑那支 SQL 的資料庫會回 42703。狀態機的正確性遠比一個
 * 統計欄位重要，不能因為少一欄就讓整個任務完成流程炸掉——那會讓使用者
 * 卡在批改頁面出不去，而他其實什麼都沒做錯。
 */
async function stampResolvedAt(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  try {
    // 回傳的 error 也刻意不檢查——supabase-js 不會丟例外，欄位不存在只會
    // 出現在回傳值裡。這裡就是要「寫得進去最好，寫不進去無所謂」。
    await supabase.from('errors').update({ resolved_at: new Date().toISOString() }).in('id', ids)
  } catch {
    // 連線層面的例外同樣吞掉：存摺少一個期間對照，不影響學習流程
  }
}
