import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { ClaudeError } from '../lib/claude'
import {
  gradeAnswer,
  generateQuiz,
  pickQuizCards,
  submitQuiz,
  QUIZ_MIN_WORDS,
  type GradedAnswer,
  type QuizQuestion,
} from '../lib/quizService'
import { VERDICT_LABELS } from '../lib/quizGrading'
import { BLANK } from '../lib/prompts/quizGenerator'
import { speak, stopSpeaking } from '../lib/speech'
import { examLanguage, type ExamSystem } from '../data/vocabLists'
import { useSpeechRate } from '../lib/useSpeechRate'
import { logActivity } from '../lib/streakService'
import { DEFAULT_VOCAB_PREF, type Language } from '../lib/types'

const VERDICT_STYLE: Record<string, string> = {
  correct: 'text-green-600',
  inflected: 'text-green-600',
  close: 'text-amber-600',
  wrong: 'text-red-600',
}

/** 把 ___ 換成視覺上的填空格 */
function SentenceWithBlank({ sentence, filled }: { sentence: string; filled?: string }) {
  const [before, after = ''] = sentence.split(BLANK)
  return (
    <p className="text-lg leading-loose">
      {before}
      <span
        className={`mx-1 inline-block min-w-[5rem] border-b-2 px-2 text-center font-bold ${
          filled ? 'border-teal-500 text-teal-700' : 'border-slate-400'
        }`}
      >
        {filled || ' '}
      </span>
      {after}
    </p>
  )
}

export default function VocabQuiz() {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const pref = profile?.vocab_pref ?? DEFAULT_VOCAB_PREF
  const language: Language = examLanguage(pref.exam as ExamSystem)

  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<GradedAnswer[]>([])
  const [typed, setTyped] = useState('')
  const [usedHint, setUsedHint] = useState(false)
  const [showHint, setShowHint] = useState(false)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [notEnough, setNotEnough] = useState(false)
  const [finished, setFinished] = useState(false)
  const [saving, setSaving] = useState(false)
  const startedRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { rate } = useSpeechRate()

  const start = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setErrorMsg('')
    setNotEnough(false)
    try {
      const cards = await pickQuizCards(profile.id, language)
      if (cards.length < QUIZ_MIN_WORDS) {
        setNotEnough(true)
        return
      }
      const qs = await generateQuiz(cards, pref.exam, pref.exam_level, language)
      if (qs.length === 0) throw new Error('出題失敗，請再試一次')
      setQuestions(qs)
      setIndex(0)
      setAnswers([])
    } catch (e: unknown) {
      const msg = e instanceof ClaudeError ? e.friendlyMessage : `出題失敗：${String((e as Error).message)}`
      setErrorMsg(msg)
    } finally {
      setLoading(false)
    }
  }, [profile, language, pref.exam, pref.exam_level])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void start()
  }, [start])

  useEffect(() => () => stopSpeaking(), [])

  // 換題時自動聚焦輸入框
  useEffect(() => {
    if (!loading && !finished) inputRef.current?.focus()
  }, [index, loading, finished])

  if (!profile) return null

  const q = questions[index]

  function submitAnswer() {
    if (!q || typed.trim() === '') return
    const graded = gradeAnswer(q, typed, usedHint)
    const next = [...answers, graded]
    setAnswers(next)
    setTyped('')
    setUsedHint(false)
    setShowHint(false)
    if (index + 1 >= questions.length) setFinished(true)
    else setIndex(index + 1)
  }

  async function finish() {
    if (!profile || saving) return
    setSaving(true)
    try {
      await submitQuiz(profile.id, language, answers)
      void logActivity(profile.id).catch(() => undefined)
      navigate('/vocab')
    } catch (e: unknown) {
      setErrorMsg(`儲存成績失敗：${String((e as Error).message)}`)
      setSaving(false)
    }
  }

  // ---------- 載入 / 錯誤 / 字數不足 ----------

  if (loading) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
        <p className="mt-20 text-center text-slate-400">正在出題，約需 10 秒…</p>
        <p className="mt-2 text-center text-sm text-slate-400">
          每題都是全新情境，不會是你背過的那句例句
        </p>
      </main>
    )
  }

  if (notEnough) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
        <div className="mt-16 rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200/60">
          <p className="text-4xl">🌱</p>
          <h1 className="mt-3 text-xl font-bold">還不夠出一份測驗</h1>
          <p className="mt-2 text-slate-500">
            測驗只考已經過了「認詞關」的字，至少要 {QUIZ_MIN_WORDS} 個。
            先去練幾輪單字，明天再回來測。
          </p>
          <button
            onClick={() => navigate('/vocab/session')}
            className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 font-bold text-white"
          >
            去練單字
          </button>
          <button
            onClick={() => navigate('/vocab')}
            className="mt-2 w-full rounded-xl bg-slate-100 py-3 font-semibold text-slate-600"
          >
            回單字庫
          </button>
        </div>
      </main>
    )
  }

  if (errorMsg && !finished) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
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
            onClick={() => navigate('/vocab')}
            className="mt-2 block w-full rounded-xl bg-white px-4 py-2 font-semibold text-slate-600"
          >
            回單字庫
          </button>
        </div>
      </main>
    )
  }

  // ---------- 成績與逐題檢討 ----------

  if (finished) {
    const score = answers.reduce((s, a) => s + a.score, 0)
    const pct = Math.round((score / answers.length) * 100)
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-12">
        <div className="rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/60">
          <p className="text-5xl">{pct >= 90 ? '🏆' : pct >= 70 ? '👍' : '💪'}</p>
          <h1 className="mt-3 text-3xl font-bold">
            {score} / {answers.length}
          </h1>
          <p className="mt-1 text-slate-500">
            正確率 {pct}%
            {answers.some((a) => a.verdict === 'wrong') && '・答錯的字明天會再出現'}
          </p>
        </div>

        <h2 className="mt-6 font-bold text-slate-700">逐題檢討</h2>
        <div className="mt-3 grid gap-3">
          {answers.map((a, i) => (
            <div key={i} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
              <div className="flex items-center justify-between">
                <span className={`text-sm font-bold ${VERDICT_STYLE[a.verdict]}`}>
                  {VERDICT_LABELS[a.verdict]}
                  {a.usedHint && <span className="ml-1 text-slate-400">（用了提示）</span>}
                </span>
                <button
                  onClick={() => void speak(a.question.card.word, language, rate).catch(() => undefined)}
                  aria-label={`聽 ${a.question.card.word} 的發音`}
                  className="rounded-full px-2 text-sm"
                >
                  🔊
                </button>
              </div>

              <div className="mt-2">
                <SentenceWithBlank sentence={a.question.sentence} filled={a.question.card.word} />
              </div>
              {a.question.sentenceZh && (
                <p className="mt-1 text-sm text-slate-500">{a.question.sentenceZh}</p>
              )}

              {a.verdict !== 'correct' && (
                <p className="mt-2 text-sm">
                  <span className="text-slate-400">你填的：</span>
                  <span className={a.verdict === 'wrong' ? 'text-red-500 line-through' : 'text-amber-600'}>
                    {a.input || '（空白）'}
                  </span>
                  <span className="mx-1 text-slate-400">→</span>
                  <span className="font-semibold text-green-600">{a.question.card.word}</span>
                </p>
              )}
              <p className="mt-1 text-sm text-slate-500">{a.question.card.meaning_zh}</p>
            </div>
          ))}
        </div>

        {errorMsg && <p className="mt-4 rounded-xl bg-red-50 p-3 text-red-600">{errorMsg}</p>}

        <button
          onClick={() => void finish()}
          disabled={saving}
          className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
        >
          {saving ? '儲存中…' : '記錄成績並結束'}
        </button>
      </main>
    )
  }

  // ---------- 作答中 ----------

  if (!q) return null

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl lg:max-w-3xl flex-col p-6 pb-10">
      <header className="flex items-center gap-3">
        <button
          onClick={() => navigate('/vocab')}
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

      <p className="mt-4 text-center text-sm font-semibold text-teal-700">每日測驗</p>

      <section className="mt-3 flex-1">
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
          <p className="text-sm text-slate-400">把空格填上正確的字</p>
          <div className="mt-3">
            <SentenceWithBlank sentence={q.sentence} filled={typed.trim()} />
          </div>
          {q.sentenceZh && <p className="mt-3 text-sm text-slate-500">{q.sentenceZh}</p>}

          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitAnswer()
            }}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="在這裡打字"
            className="mt-5 w-full rounded-xl border border-slate-300 p-3 text-center text-xl font-semibold"
          />

          {showHint ? (
            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              <p>💡 {q.hint}</p>
              <p className="mt-1">
                首字 <b>{q.card.word.slice(0, 1)}</b>・共 {q.card.word.length} 個字元
              </p>
            </div>
          ) : (
            <button
              onClick={() => {
                setShowHint(true)
                setUsedHint(true)
              }}
              className="mt-3 w-full rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-500"
            >
              想不出來，給我提示（本題最多得半分）
            </button>
          )}
        </div>
      </section>

      <footer className="mt-5">
        <button
          onClick={submitAnswer}
          disabled={typed.trim() === ''}
          className="w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-40"
        >
          {index + 1 >= questions.length ? '送出，看成績' : '下一題'}
        </button>
        <p className="mt-2 text-center text-xs text-slate-400">
          全部答完才會公布答案，中途看不到對錯
        </p>
      </footer>
    </main>
  )
}
