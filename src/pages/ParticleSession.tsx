import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { ClaudeError } from '../lib/claude'
import { buildParticleSession, gradeParticleCard, type ParticleQuestion } from '../lib/particleService'
import { logActivity } from '../lib/streakService'
import type { Grade } from '../lib/srs'

/** 把句子中恰好一次出現的目標字高亮出來 */
function HighlightedSentence({ sentence, word }: { sentence: string; word: string }) {
  const i = sentence.indexOf(word)
  if (i < 0) return <p className="text-xl leading-loose">{sentence}</p>
  return (
    <p className="text-xl leading-loose">
      {sentence.slice(0, i)}
      <span className="rounded bg-amber-200 px-1 font-bold text-amber-900">{word}</span>
      {sentence.slice(i + word.length)}
    </p>
  )
}

export default function ParticleSession() {
  const navigate = useNavigate()
  const { profile } = useProfile()

  const [questions, setQuestions] = useState<ParticleQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  const [tally, setTally] = useState({ right: 0, wrong: 0 })
  const startedRef = useRef(false)
  const loggedRef = useRef(false)

  const q = questions[index]

  const start = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setErrorMsg('')
    try {
      const qs = await buildParticleSession(profile.id)
      if (qs.length === 0) setDone(true)
      else setQuestions(qs)
    } catch (e: unknown) {
      const msg = e instanceof ClaudeError ? e.message : `載入失敗：${String((e as Error).message)}`
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void start()
  }, [start])

  if (!profile) return null

  function pick(senseId: string) {
    if (picked !== null) return
    setPicked(senseId)
  }

  async function submitGrade(grade: Grade) {
    if (!q || saving) return
    setSaving(true)
    try {
      if (!loggedRef.current) {
        loggedRef.current = true
        void logActivity(profile!.id).catch(() => undefined)
      }
      await gradeParticleCard(q.card, grade)
      setTally((t) => (grade === 'again' ? { ...t, wrong: t.wrong + 1 } : { ...t, right: t.right + 1 }))
      if (index + 1 >= questions.length) setDone(true)
      else {
        setIndex(index + 1)
        setPicked(null)
      }
    } catch (e: unknown) {
      setErrorMsg(`儲存進度失敗：${String((e as Error).message)}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p className="mt-20 text-center text-slate-400">正在準備真實例句，約需 10 秒…</p>
      </main>
    )
  }

  if (errorMsg && !done) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <div className="mt-10 rounded-2xl bg-red-50 p-4 text-red-600">
          {errorMsg}
          <button
            onClick={() => {
              startedRef.current = false
              void start()
            }}
            className="mt-3 block w-full rounded-xl bg-red-600 px-4 py-2 font-semibold text-white"
          >
            重試
          </button>
          <button
            onClick={() => navigate('/classical')}
            className="mt-2 block w-full rounded-xl bg-white px-4 py-2 font-semibold text-slate-600"
          >
            回古文
          </button>
        </div>
      </main>
    )
  }

  if (done || !q) {
    const total = tally.right + tally.wrong
    return (
      <main className="mx-auto max-w-xl p-6">
        <div className="mt-16 rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200/60">
          <p className="text-5xl">{total === 0 ? '☕' : tally.wrong === 0 ? '🏆' : '💪'}</p>
          <h1 className="mt-3 text-2xl font-bold">{total === 0 ? '今天沒有到期的虛詞' : '這輪練完了'}</h1>
          {total > 0 && (
            <p className="mt-2 text-slate-500">
              答對 {tally.right}／{total}
              {tally.wrong > 0 && '，答錯的字明天會再出現'}
            </p>
          )}
          <button
            onClick={() => navigate('/classical')}
            className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white"
          >
            回古文
          </button>
        </div>
      </main>
    )
  }

  const isCorrect = picked === q.correctSenseId

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col p-6 pb-10">
      <header className="flex items-center gap-3">
        <button
          onClick={() => navigate('/classical')}
          className="-ml-2 rounded-full px-2 text-sm font-semibold text-slate-500 active:bg-slate-100"
        >
          ← 離開
        </button>
        <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
          <span
            className="block h-full rounded-full bg-teal-500 transition-all"
            style={{ width: `${(index / questions.length) * 100}%` }}
          />
        </span>
        <span className="text-sm font-semibold text-slate-500">
          {index + 1}/{questions.length}
        </span>
      </header>

      <p className="mt-4 text-center text-sm font-semibold text-teal-700">虛詞專練・{q.card.word}</p>

      <section className="mt-3 flex-1">
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <p className="text-sm text-slate-400">這句話裡的「{q.card.word}」是哪一種用法？</p>
          <div className="mt-3">
            <HighlightedSentence sentence={q.sentence} word={q.card.word} />
          </div>
        </div>

        <div className="mt-4 grid gap-2">
          {q.options.map((opt) => {
            const isAnswer = opt.id === q.correctSenseId
            const isPicked = opt.id === picked
            let cls = 'bg-white text-slate-700 ring-1 ring-slate-200 active:bg-slate-50'
            if (picked !== null) {
              if (isAnswer) cls = 'bg-green-100 text-green-700 ring-2 ring-green-500'
              else if (isPicked) cls = 'bg-red-100 text-red-600 ring-1 ring-red-300'
              else cls = 'bg-slate-50 text-slate-400 ring-1 ring-slate-100'
            }
            return (
              <button
                key={opt.id}
                onClick={() => pick(opt.id)}
                className={`rounded-2xl p-4 text-left transition ${cls}`}
              >
                <span className="font-bold">{opt.label}</span>
                <span className="ml-2 text-sm opacity-80">{opt.desc}</span>
              </button>
            )
          })}
        </div>

        {picked !== null && (
          <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
            <p className={`text-lg font-bold ${isCorrect ? 'text-green-600' : 'text-red-600'}`}>
              {isCorrect ? '答對了！' : '答錯了'}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{q.explain}</p>
          </div>
        )}
      </section>

      <footer className="mt-5">
        {picked !== null && !isCorrect && (
          <button
            onClick={() => void submitGrade('again')}
            disabled={saving}
            className="w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-50"
          >
            知道了，下一個
          </button>
        )}
        {picked !== null && isCorrect && (
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => void submitGrade('hard')}
              disabled={saving}
              className="rounded-xl bg-amber-50 py-3.5 font-bold text-amber-700 ring-1 ring-amber-200 disabled:opacity-50"
            >
              有點難
            </button>
            <button
              onClick={() => void submitGrade('good')}
              disabled={saving}
              className="rounded-xl bg-teal-600 py-3.5 font-bold text-white disabled:opacity-50"
            >
              剛剛好
            </button>
            <button
              onClick={() => void submitGrade('easy')}
              disabled={saving}
              className="rounded-xl bg-green-50 py-3.5 font-bold text-green-700 ring-1 ring-green-200 disabled:opacity-50"
            >
              太簡單
            </button>
          </div>
        )}
      </footer>
    </main>
  )
}
