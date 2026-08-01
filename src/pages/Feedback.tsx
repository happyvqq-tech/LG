import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { processTaskCompletion } from '../lib/errorEngine'
import { clearActiveTaskId, completeTask } from '../lib/taskService'
import { callClaudeJSON, ClaudeError } from '../lib/claude'
import {
  isReviewPracticeResult,
  type ReviewPracticeInput,
  type ReviewPracticeResult,
} from '../lib/prompts/reviewPractice'
import PracticeQuiz from '../components/PracticeQuiz'
import { harvestFromTask } from '../lib/vocabService'
import { logActivity } from '../lib/streakService'
import { asTaskLanguage } from '../lib/types'
import type { DrillQuestion } from '../lib/types'

/** 用字類錯誤才值得進單字庫（時態、冠詞這類是文法問題，歸錯誤庫管） */
const VOCAB_ERROR_TYPES = ['用字', '中式表達']

function StatCard({ value, label, tone = 'slate' }: { value: string; label: string; tone?: string }) {
  const tones: Record<string, string> = {
    slate: 'text-slate-700',
    teal: 'text-teal-700',
    amber: 'text-amber-600',
    green: 'text-green-600',
  }
  return (
    <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200/60">
      <p className={`text-2xl font-bold ${tones[tone] ?? tones.slate}`}>{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
    </div>
  )
}

export default function Feedback() {
  const navigate = useNavigate()
  const { task, loading } = useActiveTask()
  const [finishing, setFinishing] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const busyRef = useRef(false)
  const [practice, setPractice] = useState<DrillQuestion[] | null>(null)
  const [practiceLoading, setPracticeLoading] = useState(false)
  const [practiceError, setPracticeError] = useState('')

  // 弱點統計：依錯誤類別分組計數（多到少）
  const weakSpots = useMemo(() => {
    const errors = task?.task_json.grading?.errors ?? []
    const counts = new Map<string, number>()
    for (const e of errors) counts.set(e.error_type, (counts.get(e.error_type) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [task])

  // 本次花費時間（任務建立 → 現在）
  const spentMinutes = useMemo(() => {
    if (!task) return 0
    const ms = Date.now() - new Date(task.created_at).getTime()
    return Math.max(1, Math.round(ms / 60_000))
  }, [task])

  if (loading || !task) return <p className="p-10 text-center text-slate-400">載入中…</p>

  const { chunks, grading, speaking_transcript } = task.task_json
  const errorCount = grading?.errors.length ?? 0
  const userTurns = (speaking_transcript ?? []).filter((m) => m.role === 'user').length

  async function loadPractice() {
    if (!task?.task_json.grading || practiceLoading) return
    setPracticeLoading(true)
    setPracticeError('')
    try {
      const language = asTaskLanguage(task.language)
      const result = await callClaudeJSON<ReviewPracticeResult>(
        {
          promptModule: 'reviewPractice',
          vars: { language, errors: task.task_json.grading.errors } satisfies ReviewPracticeInput,
          messages: [{ role: 'user', content: '請出類似題' }],
        },
        isReviewPracticeResult,
      )
      setPractice(result.questions)
    } catch (e: unknown) {
      const msg = e instanceof ClaudeError ? e.friendlyMessage : `出題失敗：${String((e as Error).message)}`
      setPracticeError(msg)
    } finally {
      setPracticeLoading(false)
    }
  }

  async function finish() {
    // busyRef 是同步鎖，理由同 Writing.tsx 的 submit()（見稽核報告 P0-3）：
    // 連點兩下曾實測造成 2 次 tasks 更新＋4 次 activity_log 寫入
    if (!task || busyRef.current) return
    busyRef.current = true
    setFinishing(true)
    setErrorMsg('')
    try {
      // 推進錯誤狀態機（未再犯 +1／驗證通過 resolved／再犯退回）
      await processTaskCompletion(task)

      // 本次語塊與用字錯誤自動進單字庫，之後由間隔重複接手
      const harvest = [
        ...task.task_json.chunks.map((c) => ({
          word: c.text,
          meaning_zh: c.zh,
          example: c.usage,
        })),
        ...(task.task_json.grading?.errors ?? [])
          .filter((e) => VOCAB_ERROR_TYPES.includes(e.error_type))
          .map((e) => ({ word: e.corrected, meaning_zh: e.rule_note, example: '' })),
      ]
      // 單字入庫失敗不該擋住任務完成
      await harvestFromTask(task.profile_id, task.language, harvest).catch(() => 0)

      await completeTask(task.id)
      void logActivity(task.profile_id).catch(() => undefined)
      clearActiveTaskId()
      navigate('/home')
    } catch (e: unknown) {
      busyRef.current = false
      setErrorMsg(`完成任務失敗：${String((e as Error).message)}`)
      setFinishing(false)
    }
  }

  return (
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-12">
      <button
        onClick={() => navigate('/home')}
        className="-ml-2 flex items-center gap-1 rounded-full px-2 text-sm font-semibold text-slate-500 active:bg-slate-100"
      >
        ← 回首頁
      </button>

      <header className="text-center">
        <p className="text-4xl">🏁</p>
        <h1 className="mt-2 text-2xl font-bold">任務總結</h1>
        <p className="mt-1 text-slate-500">{task.task_json.scenario_title}</p>
      </header>

      {/* 本次數據 */}
      <section className="mt-5 grid grid-cols-4 gap-2">
        <StatCard value={`${spentMinutes}`} label="分鐘" tone="teal" />
        <StatCard value={`${chunks.length}`} label="語塊" tone="teal" />
        <StatCard value={`${userTurns}`} label="開口" tone="teal" />
        <StatCard value={`${errorCount}`} label="待修正" tone={errorCount === 0 ? 'green' : 'amber'} />
      </section>

      {grading?.praise && (
        <p className="mt-4 rounded-2xl bg-green-50 p-4 text-center text-green-700 ring-1 ring-green-100">
          👍 {grading.praise}
        </p>
      )}

      {/* 弱點分析 */}
      {weakSpots.length > 0 && (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <h2 className="font-bold text-slate-700">這次的弱點</h2>
          <div className="mt-3 grid gap-2">
            {weakSpots.map(([type, count]) => (
              <div key={type} className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-sm font-semibold text-slate-600">{type}</span>
                <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full rounded-full bg-amber-400"
                    style={{ width: `${(count / weakSpots[0][1]) * 100}%` }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right text-sm font-bold text-amber-600">{count}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <h2 className="font-bold text-slate-700">本次學到的語塊（{chunks.length}）</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {chunks.map((c, i) => (
            <span key={i} className="rounded-full bg-teal-50 px-3 py-1.5 text-sm font-semibold text-teal-700">
              {c.text}
            </span>
          ))}
        </div>
      </section>

      {/* 問題點解釋 */}
      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <h2 className="font-bold text-slate-700">犯錯清單與解釋（{errorCount}）</h2>
        {!grading && <p className="mt-2 text-sm text-slate-400">本次未提交寫作批改</p>}
        {grading && errorCount === 0 && (
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
              {e.rule_note && (
                <p className="mt-1.5 text-sm leading-relaxed text-slate-500">💡 {e.rule_note}</p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* 類似題加練 */}
      {errorCount > 0 && (
        <section className="mt-4">
          <h2 className="font-bold text-slate-700">類似題加練</h2>
          {!practice && (
            <div className="mt-2 rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200/60">
              <p className="text-sm text-slate-500">
                換個情境考同一條規則，確認你是真的懂了還是碰巧寫對
              </p>
              <button
                onClick={() => void loadPractice()}
                disabled={practiceLoading}
                className="mt-3 w-full rounded-xl bg-teal-600 py-3 font-bold text-white disabled:opacity-60"
              >
                {practiceLoading ? '出題中，約需 10 秒…' : '開始加練 ✏️'}
              </button>
              {practiceError && (
                <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">{practiceError}</p>
              )}
            </div>
          )}
          {practice && (
            <div className="mt-2">
              <PracticeQuiz questions={practice} />
            </div>
          )}
        </section>
      )}

      {errorMsg && <p className="mt-4 rounded-xl bg-red-50 p-3 text-red-600">{errorMsg}</p>}

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
