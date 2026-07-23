import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useProfile } from '../lib/profileContext'

/** 未選擇成員時導回首頁 */
export default function RequireProfile({ children }: { children: ReactNode }) {
  const { profile } = useProfile()
  if (!profile) return <Navigate to="/" replace />
  return <>{children}</>
}
