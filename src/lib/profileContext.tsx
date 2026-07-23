import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { Profile } from './types'

const STORAGE_KEY = 'lgl.selectedProfile'

interface ProfileContextValue {
  profile: Profile | null
  selectProfile: (p: Profile) => void
  clearProfile: () => void
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
    setProfile(p)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  }, [])

  const clearProfile = useCallback(() => {
    setProfile(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <ProfileContext.Provider value={{ profile, selectProfile, clearProfile }}>
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile 必須在 ProfileProvider 內使用')
  return ctx
}
