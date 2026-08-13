// 成員存檔
//
// 唯一的重點是「向前相容」：interests 是 migration-012 才加的欄位，
// 還沒跑那支 SQL 的資料庫收到帶 interests 的 update 會整個失敗（42703）。
// 而這是編輯成員——存不了檔等於連改名字都做不到，比少一個個人化欄位嚴重太多。
// 所以偵測到欄位不存在就拿掉那一欄重送，讓其餘設定照常存下去。

import { supabase } from './supabase'
import type { DailyPlan, Language, Level, Scenario } from './types'

export interface ProfilePayload {
  name: string
  languages: Language[]
  level: Level
  scenario_pool: Scenario[]
  avatar_url: string | null
  daily_plan: DailyPlan | null
  interests: string | null
}

export interface SaveResult {
  /** 錯誤訊息，成功為 null */
  error: string | null
  /** 資料庫沒有 interests 欄位，這次的興趣沒有存進去 */
  interestsDropped: boolean
}

/** PostgreSQL：undefined column */
const UNDEFINED_COLUMN = '42703'

function isMissingInterests(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === UNDEFINED_COLUMN || Boolean(err.message?.includes('interests'))
}

export async function saveProfile(
  payload: ProfilePayload,
  profileId?: string,
): Promise<SaveResult> {
  const write = (body: Partial<ProfilePayload>) =>
    profileId
      ? supabase.from('profiles').update(body).eq('id', profileId)
      : supabase.from('profiles').insert(body)

  const first = await write(payload)
  if (!first.error) return { error: null, interestsDropped: false }

  if (isMissingInterests(first.error)) {
    const { interests: _dropped, ...rest } = payload
    const retry = await write(rest)
    return {
      error: retry.error ? retry.error.message : null,
      interestsDropped: !retry.error,
    }
  }

  return { error: first.error.message, interestsDropped: false }
}
