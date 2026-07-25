// 古文模組資料層：原文載入（快取）、學習進度讀寫
import { supabase } from './supabase'
import { loadClassicalTexts, loadClassicalNotes, CLASSICAL_INDEX, type ClassicalIndexEntry } from '../data/classicalIndex'
import type { ClassicalProgress } from './types'

// 動態載入的原文只抓一次，之後留在記憶體
let textsCache: Record<string, string[]> | null = null
let notesCache: Record<string, string[]> | null = null

export async function getText(textId: string): Promise<string[]> {
  if (!textsCache) textsCache = await loadClassicalTexts()
  return textsCache[textId] ?? []
}

export async function getNotes(textId: string): Promise<string[]> {
  if (!notesCache) notesCache = await loadClassicalNotes()
  return notesCache[textId] ?? []
}

export function getIndexEntry(textId: string) {
  return CLASSICAL_INDEX.find((e) => e.id === textId) ?? null
}

/** 某成員全部的古文進度，以 text_id 為 key */
export async function getAllProgress(profileId: string): Promise<Record<string, ClassicalProgress>> {
  const { data, error } = await supabase
    .from('classical_progress')
    .select('*')
    .eq('profile_id', profileId)
  if (error) throw new Error(error.message)

  const out: Record<string, ClassicalProgress> = {}
  for (const row of (data ?? []) as ClassicalProgress[]) out[row.text_id] = row
  return out
}

export async function getProgress(
  profileId: string,
  textId: string,
): Promise<ClassicalProgress | null> {
  const { data, error } = await supabase
    .from('classical_progress')
    .select('*')
    .eq('profile_id', profileId)
    .eq('text_id', textId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ClassicalProgress) ?? null
}

export interface ProgressPatch {
  para_index?: number
  punctuation_best?: number
  translation_best?: number
  status?: 'reading' | 'done'
}

/**
 * 寫入進度。最佳成績只升不降——重做一次考差了不該把紀錄洗掉。
 */
export async function saveProgress(
  profileId: string,
  textId: string,
  patch: ProgressPatch,
): Promise<ClassicalProgress> {
  const existing = await getProgress(profileId, textId)

  const merged = {
    profile_id: profileId,
    text_id: textId,
    para_index: Math.max(patch.para_index ?? 0, existing?.para_index ?? 0),
    punctuation_best: Math.max(patch.punctuation_best ?? 0, existing?.punctuation_best ?? 0),
    translation_best: Math.max(patch.translation_best ?? 0, existing?.translation_best ?? 0),
    status: patch.status ?? existing?.status ?? 'reading',
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('classical_progress')
    .upsert(merged, { onConflict: 'profile_id,text_id' })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as ClassicalProgress
}

export interface ClassicalStats {
  started: number
  done: number
  total: number
}

export function summarize(progress: Record<string, ClassicalProgress>): ClassicalStats {
  const rows = Object.values(progress)
  return {
    started: rows.filter((r) => r.status === 'reading').length,
    done: rows.filter((r) => r.status === 'done').length,
    total: CLASSICAL_INDEX.length,
  }
}

/** 最近有進度、還沒讀完的那一篇，供首頁「繼續讀」使用 */
export async function getResumeEntry(
  profileId: string,
): Promise<{ progress: ClassicalProgress; entry: ClassicalIndexEntry } | null> {
  const all = await getAllProgress(profileId)
  const reading = Object.values(all)
    .filter((r) => r.status === 'reading')
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  const progress = reading[0]
  if (!progress) return null
  const entry = getIndexEntry(progress.text_id)
  return entry ? { progress, entry } : null
}
