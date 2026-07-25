// 首頁「今天該做什麼」的優先順序邏輯——純函式，可獨立測試
// 依序：單字到期 > 今日測驗未做 > 今日任務未完成 > 古文有進度 > 全部完成
import type { Task } from './types'

export interface DashboardData {
  vocabDue: number
  vocabTotal: number
  quizDoneToday: boolean
  classicalResume: { textId: string; title: string; paraIndex: number; paras: number } | null
}

export type TodoItem =
  | { kind: 'vocab'; count: number }
  | { kind: 'quiz' }
  | { kind: 'task' }
  | { kind: 'classical'; textId: string; title: string; paraIndex: number; paras: number }
  | { kind: 'all_done' }

export function pickTodo(data: DashboardData, task: Task | null): TodoItem {
  if (data.vocabDue > 0) return { kind: 'vocab', count: data.vocabDue }
  if (!data.quizDoneToday && data.vocabTotal > 0) return { kind: 'quiz' }
  if (task && task.status !== 'done') return { kind: 'task' }
  if (data.classicalResume) {
    return {
      kind: 'classical',
      textId: data.classicalResume.textId,
      title: data.classicalResume.title,
      paraIndex: data.classicalResume.paraIndex,
      paras: data.classicalResume.paras,
    }
  }
  return { kind: 'all_done' }
}
