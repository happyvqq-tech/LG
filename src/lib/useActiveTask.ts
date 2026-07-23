import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadActiveTask } from './taskService'
import type { Task } from './types'

/** 練習頁共用：載入進行中任務，沒有就導回 TaskHome */
export function useActiveTask() {
  const navigate = useNavigate()
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    loadActiveTask()
      .then((t) => {
        if (!alive) return
        if (!t) navigate('/home', { replace: true })
        else setTask(t)
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
  }, [navigate])

  return { task, setTask, loading }
}
