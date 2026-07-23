import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { processTaskCompletion } from '../lib/errorEngine'
import { clearActiveTaskId, completeTask } from '../lib/taskService'

export default function Feedback() {
  const navigate = useNavigate()
  const { task, loading } = useActiveTask()
  const [finishing, setFinishing] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  if (loading || !task) return <p className="p-10 text-center text-slate-400">載入中…</p>

  const { chunks, grading } = task.task_json

  async function finish() {
    if (!task || finishing) return
    setFinishing(true)
    setErrorMsg('')
    try {
      // 推進錯誤狀態機（未再犯 +1／驗證通過 resolved／再犯退回）
      await processTaskCompletion(task)
      await completeTask(task.id)
      clearActiveTaskId()
      navigate('/home')
    } catch (e: unknown) {
      setErrorMsg(`完成任務失敗：${String((e as Error).message)}`)
      setFinishing(false)
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6 pb-12">
      <header className="pt-2 text-center">
        <p className="text-4xl">🏁</p>
        <h1 className="mt-2 text-2xl font-bold">任務總結</h1>
        <p className="mt-1 text-slate-500">{task.task_json.scenario_title}</p>
      </header>

      {grading?.praise && (
        <p className="mt-5 rounded-2xl bg-green-50 p-4 text-center text-green-700">👍 {grading.praise}</p>
      )}

      <section className="mt-5 rounded-2xl bg-white p-5 shadow">
        <h2 className="font-bold text-slate-700">本次學到的語塊（{chunks.length}）</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {chunks.map((c, i) => (
            <span key={i} className="rounded-full bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700">
              {c.text}
            </span>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-2xl bg-white p-5 shadow">
        <h2 className="font-bold text-slate-700">
          犯錯清單（{grading?.errors.length ?? 0}）
        </h2>
        {!grading && <p className="mt-2 text-sm text-slate-400">本次未提交寫作批改</p>}
        {grading && grading.errors.length === 0 && (
          <p className="mt-2 text-green-600">這次沒有新錯誤，太強了 🎉</p>
        )}
        <div className="mt-3 grid gap-2">
          {(grading?.errors ?? []).map((e, i) => (
            <div key={i} className="rounded-xl bg-slate-50 p-3">
              <span className="text-xs font-semibold text-red-500">{e.error_type}</span>
              <p className="mt-0.5 text-sm">
                <span className="text-red-500 line-through">{e.original}</span>
                {' → '}
                <span className="font-semibold text-green-600">{e.corrected}</span>
              </p>
            </div>
          ))}
        </div>
      </section>

      {errorMsg && (
        <p className="mt-4 rounded-xl bg-red-50 p-3 text-red-600">{errorMsg}</p>
      )}

      <button
        onClick={() => void finish()}
        disabled={finishing}
        className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
      >
        {finishing ? '儲存中…' : '完成任務 🎉'}
      </button>
    </main>
  )
}
