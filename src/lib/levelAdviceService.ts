// 難度建議的證據蒐集：兩張表、兩個查詢，完全不呼叫 AI

import { supabase } from './supabase'
import { toDateString, addDays } from './srs'
import { EMPTY_EVIDENCE, WINDOW_DAYS, type Evidence } from './levelAdviceRules'
import type { Language, TaskJson } from './types'

/**
 * 讀最近 14 天的寫作錯誤密度與測驗答對率。
 *
 * 只算「有批改紀錄」的任務：沒交寫作的任務錯誤數是 0，但那是沒寫，不是寫對了。
 * 把它算進平均會讓每個偷懶的人都被建議升級。
 */
export async function loadEvidence(
  profileId: string,
  language: Language,
  now = new Date(),
): Promise<Evidence> {
  const since = toDateString(addDays(now, -(WINDOW_DAYS - 1)))
  const sinceISO = new Date(`${since}T00:00:00`).toISOString()

  const [tasks, quizzes] = await Promise.all([
    supabase
      .from('tasks')
      .select('task_json')
      .eq('profile_id', profileId)
      .eq('language', language)
      .eq('status', 'done')
      .gte('created_at', sinceISO),
    supabase
      .from('vocab_quizzes')
      .select('score,total')
      .eq('profile_id', profileId)
      .gte('quiz_date', since),
  ])

  if (tasks.error || quizzes.error) return EMPTY_EVIDENCE

  const graded = ((tasks.data ?? []) as Array<{ task_json: TaskJson }>)
    .map((r) => r.task_json?.grading)
    .filter((g): g is NonNullable<typeof g> => Boolean(g))

  const quizRows = (quizzes.data ?? []) as Array<{ score: number; total: number }>
  const totalQuestions = quizRows.reduce((s, q) => s + q.total, 0)
  const totalScore = quizRows.reduce((s, q) => s + q.score, 0)

  return {
    tasksGraded: graded.length,
    avgErrors:
      graded.length > 0 ? graded.reduce((s, g) => s + g.errors.length, 0) / graded.length : null,
    quizCount: quizRows.length,
    accuracy: totalQuestions > 0 ? (totalScore / totalQuestions) * 100 : null,
  }
}
