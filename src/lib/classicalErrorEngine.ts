// 古文翻譯批改的錯誤 → 錯誤庫同步（IO 層，純邏輯見 classicalErrorRules.ts）
import { supabase } from './supabase'
import { planClassicalErrorSync } from './classicalErrorRules'
import type { TranslationIssue } from './prompts/classicalTutor'
import type { ErrorRecord } from './types'

async function fetchOpenClassicalErrors(profileId: string): Promise<ErrorRecord[]> {
  const { data, error } = await supabase
    .from('errors')
    .select('*')
    .eq('profile_id', profileId)
    .eq('language', '古文')
    .in('status', ['active', 'pending_verify'])
  if (error) throw new Error(error.message)
  return (data ?? []) as ErrorRecord[]
}

/** 翻譯批改完成後呼叫：新錯誤入庫、與本段原文相關的既有錯誤推進狀態機 */
export async function syncClassicalErrors(
  profileId: string,
  passage: string,
  issues: TranslationIssue[],
): Promise<void> {
  if (issues.length === 0) return

  const existing = await fetchOpenClassicalErrors(profileId)
  const { toInsert, updates } = planClassicalErrorSync(existing, passage, issues)

  if (toInsert.length > 0) {
    const { error } = await supabase.from('errors').insert(
      toInsert.map((iss) => ({
        profile_id: profileId,
        language: '古文',
        original: iss.original,
        corrected: iss.correct,
        error_type: iss.error_type,
        rule_note: iss.method ? `六法・${iss.method}：${iss.note}` : iss.note,
        status: 'active',
      })),
    )
    if (error) throw new Error(error.message)
  }

  for (const u of updates) {
    const { error } = await supabase.from('errors').update(u.patch).eq('id', u.id)
    if (error) throw new Error(error.message)
  }
}
