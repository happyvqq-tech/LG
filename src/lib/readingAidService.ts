// 聽力稿讀音輔助的快取層：第一次要看假名／實際發音才呼叫 AI，
// 標好存進 task_json.listening_reading_aid，之後同一個任務不用再標第二次
//
// 架構跟 translationService 一模一樣（同樣是「逐句、按需生成、寫回任務」），
// 差別只在 prompt 與適用語言。
import { callClaudeJSON } from './claude'
import {
  makeIsReadingAidResult,
  readingAidSupported,
  readingAidSystemPrompt,
} from './prompts/readingAid'
import { updateTaskJson } from './taskService'
import { splitSentences } from './speech'
import { asTaskLanguage } from './types'
import type { Task } from './types'

/**
 * 取得聽力稿逐句讀音輔助；已快取就直接回傳，沒有才呼叫 AI 並寫回任務。
 * 語言不支援（英文）時回空陣列，呼叫端不該走到這裡。
 */
export async function ensureReadingAid(task: Task): Promise<{
  aids: string[]
  task: Task
}> {
  if (!readingAidSupported(task.language)) return { aids: [], task }

  const sentences = splitSentences(task.task_json.listening_script)
  const cached = task.task_json.listening_reading_aid

  if (cached && cached.length === sentences.length) {
    return { aids: cached, task }
  }

  const language = asTaskLanguage(task.language)
  const result = await callClaudeJSON(
    {
      module: 'grader',
      system: readingAidSystemPrompt({ language, sentences }),
      messages: [{ role: 'user', content: '請標註讀音' }],
      maxTokens: 2000,
    },
    makeIsReadingAidResult(sentences.length),
  )

  const updated = await updateTaskJson(task, { listening_reading_aid: result.aids })
  return { aids: result.aids, task: updated }
}
