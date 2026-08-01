// 重寫：看完批改之後，把批改收起來，憑印象重寫一次
//
// 批改內容刻意在寫的時候藏起來（見 lib/rewriteCheck.ts 的說明）。
// 對著修正版謄一遍是抄寫，不是修改——真正有效果的是「回想剛才錯在哪」
// 這個提取動作。原文留著當底稿，因為這是修改練習不是默寫練習。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { updateTaskJson } from '../lib/taskService'
import { checkRewrite, summarize, verdictOf } from '../lib/rewriteCheck'
import TaskNav from '../components/TaskNav'

export default function Rewrite() {
  const navigate = useNavigate()
  const { task, setTask, loading } = useActiveTask()
  const [text, setText] = useState('')
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const busyRef = useRef(false)

  // 重新整理續作：已經重寫過就把內容帶回來
  useEffect(() => {
    if (task?.task_json.writing_rewrite) {
      setText(task.task_json.writing_rewrite)
      setChecked(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id])

  const errors = useMemo(() => task?.task_json.grading?.errors ?? [], [task])
  const checks = useMemo(
    () => (checked && task ? checkRewrite(text, errors, task.language) : []),
    [checked, text, errors, task],
  )
  const stats = useMemo(() => summarize(checks), [checks])

  async function check() {
    if (!task || !text.trim() || busyRef.current) return
    busyRef.current = true
    setSaving(true)
    setErrorMsg('')
    try {
      const updated = await updateTaskJson(task, { writing_rewrite: text.trim() })
      setTask(updated)
      setChecked(true)
    } catch (e: unknown) {
      // 存不起來也讓他看得到比對結果——那才是這一步的重點
      setChecked(true)
      setErrorMsg(`重寫內容沒能存起來：${String((e as Error).message)}`)
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  if (loading || !task) return <p className="p-10 text-center text-slate-400">載入中…</p>

  const original = task.task_json.writing_answer ?? ''

  if (errors.length === 0) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
        <TaskNav current="writing" />
        <p className="mt-6 rounded-2xl bg-green-50 p-5 text-center text-green-700">
          這次沒有需要修正的錯誤，不用重寫 🎉
        </p>
        <button
          onClick={() => navigate('/feedback')}
          className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white"
        >
          前往任務總結
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-12">
      <TaskNav current="writing" />
      <header>
        <p className="text-sm font-semibold text-teal-700">寫作・重寫一次</p>
        <h1 className="mt-1 text-2xl font-bold">憑印象改一遍</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          批改先收起來了。看懂跟改得掉是兩件事——
          <span className="font-semibold text-slate-700">只看不改，效果接近零</span>
          。剛才那 {errors.length} 個地方，你記得幾個？
        </p>
      </header>

      <section className="mt-5 rounded-2xl bg-slate-50 p-4">
        <p className="text-xs font-semibold text-slate-400">你原本寫的（底稿）</p>
        <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed text-slate-600">
          {original || '（沒有作答紀錄）'}
        </p>
      </section>

      <section className="mt-4">
        <label className="text-sm font-semibold text-slate-600" htmlFor="rewrite-box">
          改好的版本
        </label>
        <textarea
          id="rewrite-box"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setChecked(false)
          }}
          rows={7}
          placeholder="照著底稿重打一次，把記得的地方改掉"
          className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-lg leading-relaxed"
        />
        {!checked && (
          <>
            {original && text.trim() === '' && (
              <button
                onClick={() => setText(original)}
                className="mt-2 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600"
              >
                把底稿複製過來再改
              </button>
            )}
            <button
              onClick={() => void check()}
              disabled={saving || !text.trim()}
              className="mt-3 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-40"
            >
              {saving ? '比對中…' : '看看改掉了幾個'}
            </button>
          </>
        )}
      </section>

      {errorMsg && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">{errorMsg}</p>}

      {checked && (
        <section className="mt-6">
          <div className="rounded-2xl bg-white p-5 shadow">
            <p className="text-center text-3xl">
              {stats.stillWrong === 0 ? '🎯' : stats.fixed > 0 ? '💪' : '📝'}
            </p>
            <p className="mt-2 text-center font-bold">
              {errors.length} 個地方裡，改掉了 {stats.fixed} 個
              {stats.avoided > 0 && `，避開了 ${stats.avoided} 個`}
              {stats.stillWrong > 0 && `，還有 ${stats.stillWrong} 個沒改到`}
            </p>
          </div>

          <div className="mt-4 grid gap-3">
            {checks.map((c, i) => {
              const v = verdictOf(c)
              return (
                <div
                  key={i}
                  className={`rounded-2xl p-4 ring-1 ${
                    v === 'fixed'
                      ? 'bg-green-50 ring-green-200'
                      : v === 'still-wrong'
                        ? 'bg-red-50 ring-red-200'
                        : 'bg-slate-50 ring-slate-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-slate-500">
                      {c.error.error_type}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        v === 'fixed'
                          ? 'bg-green-600 text-white'
                          : v === 'still-wrong'
                            ? 'bg-red-600 text-white'
                            : 'bg-slate-400 text-white'
                      }`}
                    >
                      {v === 'fixed' ? '改掉了' : v === 'still-wrong' ? '還沒改到' : '換句話說避開了'}
                    </span>
                  </div>
                  <p className="mt-2 break-words">
                    <span className="text-red-500 line-through">{c.error.original}</span>
                    {' → '}
                    <span className="font-semibold text-green-700">{c.error.corrected}</span>
                  </p>
                  <p className="mt-1 text-sm text-slate-500">{c.error.rule_note}</p>
                </div>
              )
            })}
          </div>

          {stats.avoided > 0 && (
            <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-500">
              「換句話說避開了」不算失敗——繞過去也是一種能力。但它沒有證明你會用那個句型，
              所以那幾條還會留在錯誤庫裡等下次考你。
            </p>
          )}

          {stats.stillWrong > 0 && (
            <button
              onClick={() => setChecked(false)}
              className="mt-4 w-full rounded-xl bg-amber-500 py-3.5 font-bold text-white"
            >
              再改一次沒改到的
            </button>
          )}

          <button
            onClick={() => navigate('/feedback')}
            className="mt-3 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-95"
          >
            完成 → 任務總結
          </button>
        </section>
      )}

      {!checked && (
        <button
          onClick={() => navigate('/feedback')}
          className="mt-6 w-full rounded-xl bg-slate-100 py-3 font-semibold text-slate-500"
        >
          跳過，直接看總結
        </button>
      )}
    </main>
  )
}
