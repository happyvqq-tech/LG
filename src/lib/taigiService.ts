// 台語腳本的讀寫與生成（對應 taiwanese_scripts 表）
//
// 腳本刻意不綁成員：台語腳本是可以重複聽的教材，家裡誰生成的大家都能用，
// 沒必要每個人各生一份燒 AI 額度。進度（哪幾句跟讀過關）才是個人的，
// 存在 localStorage 就夠了，不值得為此開一張表。

import { supabase } from './supabase'
import { callClaudeJSON } from './claude'
import {
  isTaigiScriptJson,
  taigiScriptSystemPrompt,
  type TaigiLevel,
  type TaigiNote,
} from './prompts/taigiScript'
import type { TaiwaneseScript, TaiwaneseScriptLine } from './types'

/** 資料庫回來的列（比 TaiwaneseScript 多幾個 migration-008 加的欄位） */
export interface TaigiScriptRow extends TaiwaneseScript {
  level: string | null
  topic: string | null
  notes: TaigiNote[]
}

function normalizeRow(row: Record<string, unknown>): TaigiScriptRow {
  return {
    id: String(row.id),
    title: String(row.title ?? ''),
    lines: Array.isArray(row.lines) ? (row.lines as TaiwaneseScriptLine[]) : [],
    audio_urls: (row.audio_urls as Record<string, string>) ?? {},
    created_at: String(row.created_at ?? ''),
    level: (row.level as string | null) ?? null,
    topic: (row.topic as string | null) ?? null,
    notes: Array.isArray(row.notes) ? (row.notes as TaigiNote[]) : [],
  }
}

export async function listTaigiScripts(): Promise<TaigiScriptRow[]> {
  const { data, error } = await supabase
    .from('taiwanese_scripts')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (Array.isArray(data) ? data : []).map((r) => normalizeRow(r as Record<string, unknown>))
}

export async function getTaigiScript(id: string): Promise<TaigiScriptRow | null> {
  const { data, error } = await supabase.from('taiwanese_scripts').select('*').eq('id', id).single()
  if (error) throw new Error(error.message)
  return data ? normalizeRow(data as Record<string, unknown>) : null
}

export async function deleteTaigiScript(id: string): Promise<void> {
  const { error } = await supabase.from('taiwanese_scripts').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

/** 生成一份新腳本並存進資料庫 */
export async function generateTaigiScript(topic: string, level: TaigiLevel): Promise<TaigiScriptRow> {
  const json = await callClaudeJSON(
    {
      module: 'taigiScript',
      system: taigiScriptSystemPrompt({ topic, level }),
      messages: [{ role: 'user', content: `請生成「${topic}」的台語腳本` }],
    },
    isTaigiScriptJson,
  )

  const payload = {
    title: json.title,
    lines: json.lines,
    notes: json.notes,
    level,
    topic,
    audio_urls: {},
  }
  const { data, error } = await supabase.from('taiwanese_scripts').insert(payload).select().single()
  if (error) throw new Error(error.message)
  return normalizeRow(data as Record<string, unknown>)
}

// ---------------- 跟讀進度（個人、存本機） ----------------

const PROGRESS_PREFIX = 'lgl.taigi.progress'

function progressKey(profileId: string, scriptId: string): string {
  return `${PROGRESS_PREFIX}.${profileId}.${scriptId}`
}

/** 讀出這位成員在這份腳本裡跟讀過關的句子索引 */
export function loadTaigiProgress(profileId: string, scriptId: string): Set<number> {
  try {
    const raw = localStorage.getItem(progressKey(profileId, scriptId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((n): n is number => typeof n === 'number'))
  } catch {
    return new Set()
  }
}

export function saveTaigiProgress(profileId: string, scriptId: string, passed: Set<number>): void {
  try {
    localStorage.setItem(progressKey(profileId, scriptId), JSON.stringify([...passed]))
  } catch {
    // 存不進去只影響下次進來的進度顯示，不擋練習
  }
}
