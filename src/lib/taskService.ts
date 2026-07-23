// tasks 表的存取與「進行中任務」記憶

import { supabase } from './supabase'
import type { Language, Task, TaskJson } from './types'

const ACTIVE_KEY = 'lgl.activeTaskId'

function todayStartISO(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function getTodayPendingTask(profileId: string, language: Language): Promise<Task | null> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('profile_id', profileId)
    .eq('language', language)
    .eq('status', 'pending')
    .gte('created_at', todayStartISO())
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  return (data?.[0] as Task | undefined) ?? null
}

export async function createTask(profileId: string, language: Language, taskJson: TaskJson): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .insert({ profile_id: profileId, language, task_json: taskJson })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Task
}

/** 合併寫回 task_json（口說逐字稿、批改結果等流程資料） */
export async function updateTaskJson(task: Task, patch: Partial<TaskJson>): Promise<Task> {
  const merged: TaskJson = { ...task.task_json, ...patch }
  const { error } = await supabase.from('tasks').update({ task_json: merged }).eq('id', task.id)
  if (error) throw new Error(error.message)
  return { ...task, task_json: merged }
}

export async function completeTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', taskId)
  if (error) throw new Error(error.message)
}

export function setActiveTaskId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id)
}

export function clearActiveTaskId(): void {
  localStorage.removeItem(ACTIVE_KEY)
}

/** 各練習頁載入進行中任務（重新整理後仍可續作） */
export async function loadActiveTask(): Promise<Task | null> {
  const id = localStorage.getItem(ACTIVE_KEY)
  if (!id) return null
  const { data, error } = await supabase.from('tasks').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Task | null) ?? null
}
