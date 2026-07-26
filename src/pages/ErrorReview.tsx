import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProfile } from '../lib/profileContext'
import { callClaudeJSON, ClaudeError } from '../lib/claude'
import {
  isReviewPracticeResult,
  reviewPracticeSystemPrompt,
  type ReviewPracticeResult,
} from '../lib/prompts/reviewPractice'
import PracticeQuiz from '../components/PracticeQuiz'
import { logActivity } from '../lib/streakService'
import { TASK_LANGUAGES, type DrillQuestion, type ErrorRecord, type TaskLanguage } from '../lib/types'

/** 一次複習最多幾個錯誤，避免題目太多做不完 */
const REVIEW_CAP = 8

// 有錯誤庫的語言都要列進來。漏掉的話，錯誤庫裡的「開始複習」會導到一個
// 只寫著「找不到這個語言的錯誤庫」的死頁（韓文剛加進來時就漏了）。
const BACK_PATH: Record<string, string> = {
  古文: '/classical',
  英文: '/home',
  日文: '/home',
  韓文: '/home',
}
const ALLOWED_LANGUAGES: string[] = [...TASK_LANGUAGES, '古文']

export default function ErrorReview() {
  const navigate = useNavigate()
  const { language = '' } = useParams()
  const { profile } = useProfile()

  const [records, setRecords] = useState<ErrorRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [generating, setGenerating] = useState(false)
  const [questions, setQuestions] = useState<DrillQuestion[] | null>(null)

  const valid = ALLOWED_LANGUAGES.includes(language)
  const backPath = BACK_PATH[language] ?? '/home'

  const load = useCallback(async () => {
    if (!profile || !valid) return
    setLoading(true)
    setErrorMsg('')
    const { data, error } = await supabase
      .from('errors')
      .select('*')
      .eq('profile_id', profile.id)
      .eq('language', language)
      .in('status', ['active', 'pending_verify'])
      .order('verify_count')
      .order('created_at', { ascending: false })
    if (error) setErrorMsg(`讀取錯誤庫失敗：${error.message}`)
    else setRecords((data ?? []) as ErrorRecord[])
    setLoading(false)
  }, [profile, language, valid])

  useEffect(() => {
    void load()
  }, [load])

  const picked = useMemo(() => records.slice(0, REVIEW_CAP), [records])
  const groups = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of picked) m.set(r.error_type, (m.get(r.error_type) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [picked])

  async function start() {
    if (generating || picked.length === 0) return
    setGenerating(true)
    setErrorMsg('')
    try {
      const result = await callClaudeJSON<ReviewPracticeResult>(
        {
          module: 'grader',
          system: reviewPracticeSystemPrompt({
            language: language as TaskLanguage | '古文',
            errors: picked.map((r) => ({
              original: r.original,
              corrected: r.corrected,
              error_type: r.error_type,
              rule_note: r.rule_note,
              drill: [],
            })),
          }),
          messages: [{ role: 'user', content: '請出類似題' }],
          maxTokens: 3000,
        },
        isReviewPracticeResult,
      )
      setQuestions(result.questions)
    } catch (e: unknown) {
      const msg = e instanceof ClaudeError ? e.friendlyMessage : `出題失敗：${String((e as Error).message)}`
      setErrorMsg(msg)
    } finally {
      setGenerating(false)
    }
  }

  if (!profile) return null

  if (!valid) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
        <p className="mt-20 text-center text-slate-400">找不到這個語言的錯誤庫</p>
        <button onClick={() => navigate('/home')} className="mt-4 w-full rounded-xl bg-teal-600 py-3 font-bold text-white">
          回首頁
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-12">
      <button
        onClick={() => navigate(backPath)}
        className="-ml-2 flex items-center gap-1 rounded-full px-2 text-sm font-semibold text-slate-500 active:bg-slate-100"
      >
        ← 返回
      </button>

      <header className="mt-1">
        <h1 className="text-2xl font-bold">錯誤快複習（{language}）</h1>
        <p className="mt-1 text-sm text-slate-500">換個情境考同一條規則，確認是真的懂了還是碰巧寫對</p>
      </header>

      {loading && <p className="mt-10 text-center text-slate-400">載入中…</p>}

      {!loading && !questions && (
        <>
          {records.length === 0 ? (
            <p className="mt-10 rounded-2xl bg-white p-6 text-center text-slate-400 shadow-sm ring-1 ring-slate-200/60">
              目前沒有待複習的錯誤，很好 🎉
            </p>
          ) : (
            <>
              <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
                <p className="font-semibold text-slate-700">
                  這次複習 {picked.length} 個
                  {records.length > picked.length && `（共 ${records.length} 個待複習，先練最需要的）`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {groups.map(([type, count]) => (
                    <span
                      key={type}
                      className="rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-600"
                    >
                      {type} × {count}
                    </span>
                  ))}
                </div>
              </section>

              <button
                onClick={() => void start()}
                disabled={generating}
                className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
              >
                {generating ? '出題中，約需 10 秒…' : '開始複習'}
              </button>
            </>
          )}

          {errorMsg && (
            <div className="mt-4 rounded-xl bg-red-50 p-4 text-red-600">
              {errorMsg}
              <button
                onClick={() => void load()}
                className="mt-3 block w-full rounded-lg bg-red-600 px-4 py-2 font-semibold text-white"
              >
                重試
              </button>
            </div>
          )}
        </>
      )}

      {questions && (
        <div className="mt-5">
          <PracticeQuiz questions={questions} onFinish={() => void logActivity(profile.id).catch(() => undefined)} />
        </div>
      )}
    </main>
  )
}
