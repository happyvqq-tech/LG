import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { clearActiveTaskId } from './taskService'
import type { Profile } from './types'

const STORAGE_KEY = 'lgl.selectedProfile'

interface ProfileContextValue {
  profile: Profile | null
  selectProfile: (p: Profile) => void
  clearProfile: () => void
  /** 從資料庫重抓目前成員（跨裝置編輯後同步用） */
  refreshProfile: () => Promise<void>
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

function loadStored(): Profile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Profile) : null
  } catch {
    return null
  }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(loadStored)

  const selectProfile = useCallback((p: Profile) => {
    // 換成不同的人時，把上一位留下的進行中任務 id 清掉——不然共用裝置時
    // 這位翻到練習頁會直接看到、甚至誤送出上一位的任務內容（見稽核報告 P0-1）
    setProfile((prev) => {
      if (prev && prev.id !== p.id) clearActiveTaskId()
      return p
    })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  }, [])

  const clearProfile = useCallback(() => {
    clearActiveTaskId()
    setProfile(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  // localStorage 只是快取；資料真相在 Supabase，故進入學習頁時重抓一次
  const refreshProfile = useCallback(async () => {
    const id = profile?.id
    if (!id) return
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
    if (error || !data) return
    const fresh = data as Profile
    setProfile(fresh)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh))
  }, [profile?.id])

  return (
    <ProfileContext.Provider value={{ profile, selectProfile, clearProfile, refreshProfile }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile 必須在 ProfileProvider 內使用')
  return ctx
}
