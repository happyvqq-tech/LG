import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadActiveTask, clearActiveTaskId } from './taskService'
import { useProfile } from './profileContext'
import type { Task } from './types'

/** 練習頁共用：載入進行中任務，沒有就導回 TaskHome */
export function useActiveTask() {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    loadActiveTask()
      .then((t) => {
        if (!alive) return
        // 共用裝置防呆：撈到的任務若不屬於目前登入的成員，視同沒有進行中任務
        // （理論上換人時 activeTaskId 已經被清掉，這裡是第二道保險，見稽核報告 P0-1）
        if (t && profile && t.profile_id !== profile.id) {
          clearActiveTaskId()
          navigate('/home', { replace: true })
        } else if (!t) {
          navigate('/home', { replace: true })
        } else {
          setTask(t)
        }
      })
      .catch(() => {
        if (alive) navigate('/home', { replace: true })
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [navigate, profile])

  return { task, setTask, loading }
}
