// 聽力稿逐句中文翻譯的快取層：第一次要看中文才呼叫 AI，翻好存進
// task_json.listening_translation，之後同一個任務不用再翻第二次
import { callClaudeJSON } from './claude'
import { makeIsTranslateResult, translateSystemPrompt } from './prompts/translate'
import { updateTaskJson } from './taskService'
import { splitSentences } from './speech'
import type { Task } from './types'

/** 取得聽力稿逐句中文翻譯；已快取就直接回傳，沒有才呼叫 AI 並寫回任務 */
export async function ensureListeningTranslation(task: Task): Promise<{
  translations: string[]
  task: Task
}> {
  const sentences = splitSentences(task.task_json.listening_script)
  const cached = task.task_json.listening_translation

  if (cached && cached.length === sentences.length) {
    return { translations: cached, task }
  }

  const language = task.language === '日文' ? '日文' : '英文'
  const result = await callClaudeJSON(
    {
      module: 'grader',
      system: translateSystemPrompt({ language, sentences }),
      messages: [{ role: 'user', content: '請翻譯' }],
      maxTokens: 1500,
    },
    makeIsTranslateResult(sentences.length),
  )

  const updated = await updateTaskJson(task, { listening_translation: result.translations })
  return { translations: result.translations, task: updated }
}
