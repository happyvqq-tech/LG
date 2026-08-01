// 泛聽教材的資料層：生成、列出、刪除

import { supabase } from './supabase'
import { callClaudeJSON } from './claude'
import { extensiveLevel, extensiveSystemPrompt, isExtensiveResult } from './prompts/extensive'
import type { ExtensiveListen, Level, TaskLanguage } from './types'

export async function listExtensive(
  profileId: string,
  language: TaskLanguage,
  limit = 50,
): Promise<ExtensiveListen[]> {
  const { data, error } = await supabase
    .from('extensive_listens')
    .select('*')
    .eq('profile_id', profileId)
    .eq('language', language)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as ExtensiveListen[]
}

export async function getExtensive(
  id: string,
  profileId: string,
): Promise<ExtensiveListen | null> {
  const { data, error } = await supabase
    .from('extensive_listens')
    .select('*')
    .eq('id', id)
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ExtensiveListen | null) ?? null
}

/**
 * 生成一篇泛聽材料並存起來。
 *
 * 程度會自動降一級（見 prompts/extensive.ts 的說明）——泛聽要的是
 * 不查字典就聽得懂，用學習程度生成會變成又一份需要專心解碼的東西。
 */
export async function createExtensive(
  profileId: string,
  language: TaskLanguage,
  level: Level,
  topic: string,
): Promise<ExtensiveListen> {
  const easier = extensiveLevel(level)
  const result = await callClaudeJSON(
    {
      module: 'taskGenerator',
      system: extensiveSystemPrompt({ language, level: easier, topic }),
      messages: [{ role: 'user', content: '請生成一篇泛聽材料' }],
      maxTokens: 3000,
    },
    isExtensiveResult,
  )

  const { data, error } = await supabase
    .from('extensive_listens')
    .insert({
      profile_id: profileId,
      language,
      title: result.title.trim(),
      script: result.script.trim(),
      topic,
      level: easier,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as ExtensiveListen
}

export async function deleteExtensive(id: string, profileId: string): Promise<void> {
  const { error } = await supabase
    .from('extensive_listens')
    .delete()
    .eq('id', id)
    .eq('profile_id', profileId)
  if (error) throw new Error(error.message)
}
