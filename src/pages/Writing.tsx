import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { callClaudeJSON, ClaudeError } from '../lib/claude'
import { syncTaskErrors } from '../lib/errorEngine'
import { graderSystemPrompt, graderUserMessage, isGraderResult } from '../lib/prompts/grader'
import { updateTaskJson } from '../lib/taskService'
import { diffTokens } from '../lib/textDiff'
import DrillModal from '../components/DrillModal'
import TaskNav from '../components/TaskNav'
import { asTaskLanguage } from '../lib/types'
import type { GraderError, GraderResult } from '../lib/types'

function countUnits(text: string, language: string): number {
  if (language === '日文') return Array.from(text.trim()).length
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length
}

/** 內容比這個短，批改的參考價值有限，給個軟性提示（不擋送出） */
const MIN_UNITS_HINT = 8

export default function Writing() {
  const navigate = useNavigate()
  const { task, setTask, loading } = useActiveTask()
  const [answer, setAnswer] = useState('')
  const [grading, setGrading] = useState<GraderResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [drillError, setDrillError] = useState<GraderError | null>(null)
  const busyRef = useRef(false)

  // 復原已作答/已批改的狀態（重新整理續作）
  useEffect(() => {
    if (!task) return
    if (task.task_json.writing_answer) setAnswer(task.task_json.writing_answer)
    if (task.task_json.grading) setGrading(task.task_json.grading)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id])

  const diff = useMemo(() => {
    if (!grading || !task) return null
    return diffTokens(grading.minimal_fix, grading.native_version, task.language)
  }, [grading, task])

  if (loading || !task) return <p className="p-10 text-center text-slate-400">載入中…</p>

  const language = asTaskLanguage(task.language)
  const unitName = language === '日文' ? '字' : '字（words）'
  const units = countUnits(answer, language)

  async function submit() {
    // busyRef 是同步鎖：手指連點兩下會在 state 更新生效前就衝進來第二次，
    // 光靠 submitting 這個 state 擋不住（見稽核報告 P0-3）
    if (!task || !answer.trim() || busyRef.current) return
    busyRef.current = true
    setSubmitting(true)
    setErrorMsg('')
    try {
      const result = await callClaudeJSON<GraderResult>(
        {
          module: 'grader',
          system: graderSystemPrompt(language),
          messages: [
            {
              role: 'user',
              content: graderUserMessage({
                writingPrompt: task.task_json.writing_prompt,
                answer: answer.trim(),
                speakingTranscript: task.task_json.speaking_transcript,
              }),
            },
          ],
        },
        isGraderResult,
      )
      setGrading(result)
      const updated = await updateTaskJson(task, { grading: result, writing_answer: answer.trim() })
      // 新錯誤寫入錯誤記憶庫（status='active'；重新批改會先清掉上一輪寫入的）
      const synced = await syncTaskErrors(updated, result.errors)
      setTask(synced)
    } catch (e: unknown) {
      const msg = e instanceof ClaudeError ? e.friendlyMessage : `批改失敗：${String((e as Error).message)}`
      setErrorMsg(msg)
    } finally {
      busyRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-12">
      <TaskNav current="writing" />
      <header>
        <p className="text-sm font-semibold text-teal-700">第四關・寫作</p>
        <h1 className="mt-1 break-words text-2xl font-bold">{task.task_json.scenario_title}</h1>
      </header>

      <section className="mt-4 rounded-2xl bg-white p-5 shadow">
        <p className="font-semibold text-slate-700">{task.task_json.writing_prompt}</p>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={6}
          disabled={submitting}
          placeholder="30-80 字即可完成"
          className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-lg"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-sm text-slate-400">
            {units} {unitName}
          </span>
          <button
            onClick={() => void submit()}
            disabled={submitting || !answer.trim()}
            className="rounded-xl bg-teal-600 px-6 py-2.5 font-bold text-white disabled:opacity-40"
          >
            {submitting ? '批改中…' : grading ? '重新批改' : '提交批改'}
          </button>
        </div>
        {answer.trim() !== '' && units < MIN_UNITS_HINT && !grading && (
          <p className="mt-1.5 text-xs text-amber-600">內容有點短，批改可能不夠準確，建議再多寫一點</p>
        )}
        {errorMsg && (
          <div className="mt-3 rounded-xl bg-red-50 p-3 text-red-600">
            {errorMsg}
            <button
              onClick={() => void submit()}
              className="ml-3 rounded bg-red-600 px-3 py-1 font-semibold text-white"
            >
              重試
            </button>
          </div>
        )}
      </section>

      {grading && diff && (
        <section className="mt-6">
          <h2 className="text-lg font-bold text-slate-700">批改結果</h2>

          {grading.praise && (
            <p className="mt-3 rounded-2xl bg-green-50 p-4 text-green-700">👍 {grading.praise}</p>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-white p-4 shadow">
              <p className="text-sm font-semibold text-slate-500">最小修改版</p>
              <p className="mt-2 break-words leading-relaxed">
                {diff.a.map((t, i) => (
                  <span key={i} className={t.changed ? 'rounded bg-amber-200' : ''}>
                    {t.text}
                  </span>
                ))}
              </p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow">
              <p className="text-sm font-semibold text-slate-500">母語自然版</p>
              <p className="mt-2 break-words leading-relaxed">
                {diff.b.map((t, i) => (
                  <span key={i} className={t.changed ? 'rounded bg-sky-200' : ''}>
                    {t.text}
                  </span>
                ))}
              </p>
            </div>
          </div>

          {grading.errors.length === 0 && (
            <p className="mt-4 rounded-2xl bg-white p-4 text-center text-slate-500 shadow">
              沒有需要修正的錯誤 🎉
            </p>
          )}

          <div className="mt-4 grid gap-3">
            {grading.errors.map((e, i) => (
              <div key={i} className="rounded-2xl bg-white p-4 shadow">
                <span className="inline-block rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-600">
                  {e.error_type}
                </span>
                <p className="mt-2">
                  <span className="text-red-500 line-through">{e.original}</span>
                  {' → '}
                  <span className="font-semibold text-green-600">{e.corrected}</span>
                </p>
                <p className="mt-1 text-sm text-slate-500">{e.rule_note}</p>
                <button
                  onClick={() => setDrillError(e)}
                  className="mt-3 rounded-xl bg-teal-50 px-4 py-2 font-semibold text-teal-700"
                >
                  ⏱ 30 秒微課
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => navigate('/feedback')}
            className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-95"
          >
            完成寫作 → 任務總結
          </button>
        </section>
      )}

      {drillError && <DrillModal error={drillError} onClose={() => setDrillError(null)} />}
    </main>
  )
}
