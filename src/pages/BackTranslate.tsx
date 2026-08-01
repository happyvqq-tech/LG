// 回譯練習：看中文，說（寫）出目標語，再翻開跟原句比對
//
// 為什麼是回譯而不是再看一次原文：中文母語者的瓶頸不是「看不懂」而是「產不出」。
// 看懂原句的感覺會騙人——那是再認（recognition），成本低、也不會留下多少東西；
// 從意義端把句子重新產出來才是提取練習（retrieval），而提取才是真正在強化記憶。
//
// 比對的對象刻意是「他前幾天才聽過的那句母語者說法」，不是抽象文法規則，
// 落差看得見、也具體到可以馬上修。
//
// 這頁不寫任何練習結果回資料庫（教材庫是唯讀的），只在做完時記一筆當日活動。
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { getTaskById } from '../lib/taskService'
import { ensureListeningTranslation } from '../lib/translationService'
import { speak, splitSentences, stopSpeaking } from '../lib/speech'
import { diffTokens, type DiffToken } from '../lib/textDiff'
import { logActivity } from '../lib/streakService'
import { useSpeechRate } from '../lib/useSpeechRate'
import type { Language, Task } from '../lib/types'

/** 差異高亮：原句用綠色標出你沒寫到的，你的答案用紅色標出多餘或寫錯的 */
function DiffText({ tokens, tone }: { tokens: DiffToken[]; tone: 'mine' | 'origin' }) {
  return (
    <p className="whitespace-pre-wrap break-words leading-relaxed">
      {tokens.map((t, i) =>
        t.changed ? (
          <span
            key={i}
            className={
              tone === 'mine'
                ? 'rounded bg-red-100 text-red-700'
                : 'rounded bg-green-100 font-semibold text-green-800'
            }
          >
            {t.text}
          </span>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </p>
  )
}

export default function BackTranslate() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const { profile } = useProfile()
  const { rate } = useSpeechRate()

  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  const [index, setIndex] = useState(0)
  const [input, setInput] = useState('')
  const [revealed, setRevealed] = useState(false)
  /** 每句的自評結果，undefined 代表還沒做到 */
  const [marks, setMarks] = useState<boolean[]>([])
  const [finished, setFinished] = useState(false)

  useEffect(() => {
    if (!profile || !taskId) return
    let alive = true
    setLoading(true)
    getTaskById(taskId, profile.id)
      .then(async (t) => {
        if (!alive) return
        if (!t) {
          navigate('/archive', { replace: true })
          return
        }
        // 舊教材當初沒按過「顯示中文」就沒有翻譯，這裡補生成一次
        // （純新增欄位，不動既有紀錄）。沒有中文就沒得回譯，所以必須等它。
        const { task: withTranslation } = await ensureListeningTranslation(t)
        if (alive) setTask(withTranslation)
      })
      .catch((e: unknown) => {
        if (alive) setErrorMsg(`準備練習失敗：${String((e as Error).message)}`)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [profile, taskId, navigate])

  useEffect(() => {
    return () => stopSpeaking()
  }, [])

  const sentences = useMemo(
    () => splitSentences(task?.task_json.listening_script ?? ''),
    [task],
  )
  const translations = task?.task_json.listening_translation ?? []
  const lang: Language = task?.language ?? '英文'

  const original = sentences[index] ?? ''
  const zh = translations[index] ?? ''
  const diff = useMemo(
    () => (revealed ? diffTokens(input, original, lang) : null),
    [revealed, input, original, lang],
  )

  function next(correct: boolean) {
    const nextMarks = [...marks]
    nextMarks[index] = correct
    setMarks(nextMarks)
    stopSpeaking()
    if (index + 1 >= sentences.length) {
      setFinished(true)
      if (profile) void logActivity(profile.id).catch(() => undefined)
      return
    }
    setIndex(index + 1)
    setInput('')
    setRevealed(false)
  }

  function restart() {
    setIndex(0)
    setInput('')
    setRevealed(false)
    setMarks([])
    setFinished(false)
  }

  if (loading) {
    return (
      <p className="p-10 text-center text-slate-400">
        準備中…（第一次練這篇要先產生中文對照）
      </p>
    )
  }

  if (!task || sentences.length === 0) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p className="rounded-xl bg-red-50 p-4 text-red-600">
          {errorMsg || '這份教材沒有可以回譯的內容'}
        </p>
        <button
          onClick={() => navigate('/archive')}
          className="mt-4 w-full rounded-xl bg-slate-100 py-3 font-semibold text-slate-600"
        >
          回教材庫
        </button>
      </main>
    )
  }

  if (finished) {
    const correct = marks.filter(Boolean).length
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-6">
        <div className="rounded-3xl bg-white p-8 text-center shadow">
          <p className="text-5xl">{correct === sentences.length ? '🏆' : '✍️'}</p>
          <p className="mt-3 text-xl font-bold">回譯完成</p>
          <p className="mt-1 text-slate-500">
            {sentences.length} 句裡，你覺得寫對了 {correct} 句
          </p>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            寫不出來的那幾句就是你的真實程度所在——看得懂不等於說得出來，
            這正是回譯要抓的東西。
          </p>
          <button
            onClick={restart}
            className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 font-bold text-white"
          >
            再練一次
          </button>
          <button
            onClick={() => navigate(`/archive/${task.id}`)}
            className="mt-2 w-full rounded-xl bg-slate-100 py-3 font-semibold text-slate-600"
          >
            回這篇教材
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-16">
      <button
        onClick={() => {
          stopSpeaking()
          navigate(`/archive/${task.id}`)
        }}
        className="-ml-2 flex items-center gap-1 rounded-full px-2 text-sm font-semibold text-slate-500 active:bg-slate-100"
      >
        ← 離開練習
      </button>

      <header className="mt-2">
        <p className="text-sm font-semibold text-teal-700">✍️ 回譯練習・{task.language}</p>
        <h1 className="mt-1 break-words text-xl font-bold">{task.task_json.scenario_title}</h1>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-teal-500 transition-all"
            style={{ width: `${((index + (revealed ? 1 : 0)) / sentences.length) * 100}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-400">
          第 {index + 1} / {sentences.length} 句
        </p>
      </header>

      {/* 中文提示 */}
      <section className="mt-5 rounded-3xl bg-white p-6 shadow">
        <p className="text-xs font-semibold text-slate-400">用{task.language}說出這句話</p>
        <p className="mt-2 text-xl font-bold leading-relaxed">{zh || '（這句沒有中文對照）'}</p>
      </section>

      {!revealed ? (
        <>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            rows={3}
            placeholder="先自己想過一次再寫，想不出來就直接看答案"
            className="mt-4 w-full rounded-2xl border border-slate-300 p-4 text-lg leading-relaxed"
          />
          <button
            onClick={() => setRevealed(true)}
            className="mt-3 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white"
          >
            對答案
          </button>
          <p className="mt-2 text-center text-xs text-slate-400">
            寫不出來也直接按——知道自己寫不出來，本身就是有用的資訊
          </p>
        </>
      ) : (
        <>
          {input.trim() && (
            <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
              <p className="text-xs font-semibold text-slate-400">你寫的</p>
              <div className="mt-1">
                {diff && <DiffText tokens={diff.a} tone="mine" />}
              </div>
            </section>
          )}

          <section className="mt-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-teal-200">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-semibold text-teal-600">原句（母語者說法）</p>
              <button
                onClick={() => void speak(original, lang, rate).catch(() => undefined)}
                aria-label="播放原句"
                className="h-9 w-9 shrink-0 rounded-full bg-teal-50 text-sm active:bg-teal-100"
              >
                🔊
              </button>
            </div>
            <div className="mt-1">
              {diff ? <DiffText tokens={diff.b} tone="origin" /> : <p>{original}</p>}
            </div>
            {input.trim() && (
              <p className="mt-3 text-xs text-slate-400">
                綠色是原句有、你沒寫到的；紅色是你多寫或寫錯的。用字不同不一定是錯，
                但值得看一眼母語者為什麼那樣說。
              </p>
            )}
          </section>

          <div className="mt-4 flex gap-3">
            <button
              onClick={() => next(false)}
              className="flex-1 rounded-xl bg-slate-100 py-3.5 font-bold text-slate-600"
            >
              差很多
            </button>
            <button
              onClick={() => next(true)}
              className="flex-1 rounded-xl bg-teal-600 py-3.5 font-bold text-white"
            >
              差不多 ✓
            </button>
          </div>
        </>
      )}

      {errorMsg && <p className="mt-4 rounded-xl bg-red-50 p-4 text-red-600">{errorMsg}</p>}
    </main>
  )
}
