// 「今天只有 5 分鐘」——一次一張卡的微型練習
//
// 存在的理由：連續天數斷掉，很少是因為不想學，而是今天真的沒空做完整任務，
// 於是乾脆跳過，隔天發現斷了就放棄了。這個入口就是那個台階——
// 忙的日子也有一個五分鐘做得完、而且真的算數的選項（做完一樣寫 activity_log）。
//
// 內容全部是「本來就該複習」的東西，不生成新教材，所以不花任何 API 費用。
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { loadQuickPlan } from '../lib/quickService'
import { minutesLabel, planBreakdown, EMPTY_PLAN, type QuickItem, type QuickPlan } from '../lib/quickRules'
import { gradeCard } from '../lib/vocabService'
import { getStreak, logActivity } from '../lib/streakService'
import { speak, stopSpeaking } from '../lib/speech'
import type { VocabCard } from '../lib/types'

export default function QuickSession() {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const [plan, setPlan] = useState<QuickPlan | null>(null)
  const [index, setIndex] = useState(0)
  const [revealed, setRevealed] = useState(false)
  const [done, setDone] = useState(false)
  const [streak, setStreak] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [now] = useState(() => new Date())
  /** 同步鎖：避免連點造成重複寫入（理由同 Feedback.finish） */
  const finishingRef = useRef(false)

  useEffect(() => {
    if (!profile) return
    let alive = true
    loadQuickPlan(profile, now)
      .then((p) => {
        if (alive) setPlan(p)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setPlan(EMPTY_PLAN)
        setErrorMsg(`讀取失敗：${String((e as Error).message)}`)
      })
    return () => {
      alive = false
    }
  }, [profile, now])

  // 離開頁面時把還在播的聲音停掉，不要跟著使用者跑到下一頁
  useEffect(() => stopSpeaking, [])

  async function finish() {
    if (!profile || finishingRef.current) return
    finishingRef.current = true
    stopSpeaking()
    setDone(true)
    // 這一步就是整個模式的重點：五分鐘也算數，連續天數不會斷
    await logActivity(profile.id).catch(() => undefined)
    const s = await getStreak(profile.id).then((r) => r.current).catch(() => null)
    setStreak(s)
  }

  function next() {
    if (!plan) return
    stopSpeaking()
    setRevealed(false)
    if (index + 1 >= plan.items.length) void finish()
    else setIndex(index + 1)
  }

  async function grade(card: VocabCard, remembered: boolean) {
    // 寫回 SRS 失敗不該擋住練習流程——這張卡下次還是會到期，損失有限
    await gradeCard(card, remembered ? 'good' : 'again').catch(() => undefined)
    next()
  }

  if (!profile) return null

  if (done) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-7 text-center">
        <p className="text-6xl">✅</p>
        <h1 className="mt-5 text-2xl font-bold">五分鐘完成</h1>
        {plan && plan.items.length > 0 && (
          <p className="mt-2 text-sm text-slate-500">{planBreakdown(plan.items)}</p>
        )}
        {streak !== null && streak > 0 && (
          <p className="mt-4">
            <span className="inline-block rounded-full bg-teal-50 px-4 py-2 text-sm font-bold text-teal-700">
              🔥 連續 {streak} 天
            </span>
          </p>
        )}
        <p className="mt-4 text-sm leading-relaxed text-slate-500">
          今天的紀錄已經留下了。忙的日子做一點就好，明天再接回來。
        </p>
        <button
          onClick={() => navigate('/home')}
          className="mt-8 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-[0.98]"
        >
          回首頁
        </button>
      </main>
    )
  }

  if (plan === null) return <p className="p-10 text-center text-slate-400">整理中…</p>

  if (plan.items.length === 0) {
    return (
      <main className="mx-auto max-w-md p-6 pb-16">
        <header className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold">五分鐘</h1>
          <Link to="/home" className="rounded-full px-4 py-2 text-sm text-slate-500 active:bg-slate-100">
            返回
          </Link>
        </header>
        {errorMsg && <p className="mt-5 rounded-xl bg-red-50 p-4 text-red-600">{errorMsg}</p>}
        <div className="mt-6 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/60">
          <p className="text-4xl">🌤️</p>
          <p className="mt-3 font-semibold text-slate-700">現在沒有到期的複習</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            這個模式只排「本來就該複習」的東西——到期單字、錯誤庫的舊錯、該重聽的教材。
            目前三種都沒有，表示進度是超前的。
          </p>
          <button
            onClick={() => navigate('/home')}
            className="mt-5 w-full rounded-xl bg-teal-600 py-3 font-bold text-white"
          >
            去做今天的任務
          </button>
        </div>
      </main>
    )
  }

  const item = plan.items[index]

  return (
    <main className="mx-auto max-w-md p-6 pb-16">
      <header className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-xl font-bold">五分鐘</h1>
          <p className="text-xs text-slate-500">
            {index + 1} / {plan.items.length}・{minutesLabel(plan.seconds)}
          </p>
        </div>
        <Link
          to="/home"
          onClick={stopSpeaking}
          className="rounded-full px-4 py-2 text-sm text-slate-500 active:bg-slate-100"
        >
          離開
        </Link>
      </header>

      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-teal-600 transition-all duration-300"
          style={{ width: `${(index / plan.items.length) * 100}%` }}
        />
      </div>

      <QuickCard item={item} revealed={revealed} onReveal={() => setRevealed(true)} />

      <div className="mt-5">
        {item.kind === 'vocab' && revealed ? (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => void grade(item.card, false)}
              className="rounded-xl bg-slate-100 py-3.5 font-bold text-slate-600 active:scale-[0.98]"
            >
              忘了
            </button>
            <button
              onClick={() => void grade(item.card, true)}
              className="rounded-xl bg-teal-600 py-3.5 font-bold text-white active:scale-[0.98]"
            >
              記得
            </button>
          </div>
        ) : revealed || item.kind === 'listen' ? (
          <button
            onClick={next}
            className="w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-[0.98]"
          >
            {index + 1 >= plan.items.length ? '完成' : '下一個'}
          </button>
        ) : (
          <button
            onClick={() => setRevealed(true)}
            className="w-full rounded-xl bg-white py-3.5 text-lg font-bold text-teal-700 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
          >
            看答案
          </button>
        )}
      </div>
    </main>
  )
}

/** 一張卡的內容。三種來源的版面刻意長得像，切換時不會有跳動感 */
function QuickCard({
  item,
  revealed,
  onReveal,
}: {
  item: QuickItem
  revealed: boolean
  onReveal: () => void
}) {
  // 換到聽力卡就自動播一次，不用再多按一個鍵——五分鐘模式的每一次點擊都是成本
  useEffect(() => {
    if (item.kind !== 'listen') return
    void speak(item.listen.sentence, item.listen.language).catch(() => undefined)
    return stopSpeaking
  }, [item])

  if (item.kind === 'vocab') {
    return (
      <section className="mt-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <p className="text-xs font-semibold text-teal-700">到期單字</p>
        <p className="mt-3 text-3xl font-bold text-slate-800">{item.card.word}</p>
        {item.card.reading && <p className="mt-1 text-sm text-slate-400">{item.card.reading}</p>}
        {revealed ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="font-semibold text-slate-700">{item.card.meaning_zh}</p>
            {item.card.example && (
              <p className="mt-2 text-sm leading-relaxed text-slate-500">{item.card.example}</p>
            )}
          </div>
        ) : (
          <button onClick={onReveal} className="mt-4 text-sm text-slate-400">
            想一下意思，再看答案
          </button>
        )}
      </section>
    )
  }

  if (item.kind === 'error') {
    return (
      <section className="mt-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
        <p className="text-xs font-semibold text-amber-600">
          舊錯重溫・{item.error.language} {item.error.error_type}
        </p>
        <p className="mt-3 text-xl font-semibold leading-relaxed text-slate-800">{item.error.original}</p>
        {revealed ? (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <p className="text-lg font-bold leading-relaxed text-teal-700">{item.error.corrected}</p>
            {item.error.rule_note && (
              <p className="mt-2 text-sm leading-relaxed text-slate-500">💡 {item.error.rule_note}</p>
            )}
          </div>
        ) : (
          <button onClick={onReveal} className="mt-4 text-sm text-slate-400">
            這句哪裡要改？想好再看答案
          </button>
        )}
      </section>
    )
  }

  return (
    <section className="mt-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
      <p className="text-xs font-semibold text-teal-700">重聽・{item.listen.title}</p>
      <p className="mt-3 text-lg leading-relaxed text-slate-800">{item.listen.sentence}</p>
      <button
        onClick={() => void speak(item.listen.sentence, item.listen.language).catch(() => undefined)}
        className="mt-4 rounded-xl bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700"
      >
        🔊 再播一次
      </button>
    </section>
  )
}
