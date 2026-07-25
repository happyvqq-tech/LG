// 首頁「今天該做什麼」彙總：把單字複習、每日測驗、古文進度、今日任務、
// 連續天數彙整成一個入口，一鍵直達最急迫的那件事。
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getVocabStats } from '../lib/vocabService'
import { getQuizHistory, takenToday } from '../lib/quizService'
import { getResumeEntry } from '../lib/classicalService'
import { getStreak, type StreakInfo } from '../lib/streakService'
import { examLanguage, type ExamSystem } from '../data/vocabLists'
import { setActiveTaskId } from '../lib/taskService'
import { pickTodo, type TodoItem } from '../lib/dashboardRules'
import { DEFAULT_VOCAB_PREF, type Profile, type Task } from '../lib/types'

interface DashboardData {
  vocabDue: number
  vocabTotal: number
  quizDoneToday: boolean
  classicalResume: { textId: string; title: string; paraIndex: number; paras: number } | null
  streak: StreakInfo
}

export default function TodayDashboard({
  profile,
  task,
  taskLoading,
}: {
  profile: Profile
  task: Task | null
  /** 今日任務還在抓取中——抓到之前不能下「今天都做完了」的結論，
   *  不然慢網路下 task 暫時是 null 會被誤判成沒有任務可做（見稽核報告 P1-6） */
  taskLoading: boolean
}) {
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const pref = profile.vocab_pref ?? DEFAULT_VOCAB_PREF
      const vocabLanguage = examLanguage(pref.exam as ExamSystem)
      const [vocabStats, quizHistory, classicalResume, streak] = await Promise.all([
        getVocabStats(profile.id, vocabLanguage).catch(() => ({ due: 0, learning: 0, mastered: 0, total: 0 })),
        getQuizHistory(profile.id, vocabLanguage).catch(() => []),
        getResumeEntry(profile.id).catch(() => null),
        getStreak(profile.id).catch(() => ({ current: 0, longest: 0, last7: Array(7).fill(false), activeToday: false })),
      ])
      if (cancelled) return
      setData({
        vocabDue: vocabStats.due,
        vocabTotal: vocabStats.total,
        quizDoneToday: takenToday(quizHistory) !== null,
        classicalResume: classicalResume
          ? {
              textId: classicalResume.entry.id,
              title: classicalResume.entry.title,
              paraIndex: classicalResume.progress.para_index,
              paras: classicalResume.entry.paras,
            }
          : null,
        streak,
      })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [profile])

  if (!data) return null

  if (taskLoading) {
    return (
      <section className="mt-4 rounded-2xl bg-gradient-to-br from-teal-600 to-teal-700 p-5 text-white shadow-md shadow-teal-600/20">
        <p className="text-sm font-semibold text-teal-50/90">今天</p>
        <p className="mt-2 text-sm text-teal-50/80">載入中…</p>
      </section>
    )
  }

  const todo = pickTodo(data, task)

  function go() {
    switch (todo.kind) {
      case 'vocab':
        navigate('/vocab/session')
        break
      case 'quiz':
        navigate('/vocab/quiz')
        break
      case 'task':
        if (task) setActiveTaskId(task.id)
        navigate('/listening')
        break
      case 'classical':
        navigate(`/classical/${todo.textId}`)
        break
    }
  }

  function ctaFor(item: TodoItem): { icon: string; title: string; desc: string } {
    switch (item.kind) {
      case 'vocab':
        return { icon: '🗂️', title: `複習 ${item.count} 個單字`, desc: '間隔重複到期，趁還記得的時候複習' }
      case 'quiz':
        return { icon: '📝', title: '今日單字測驗', desc: '換個新句子檢測，看是不是真的會用' }
      case 'task':
        return { icon: '🎯', title: '今日任務還沒做完', desc: '繼續聽→讀→說→寫' }
      case 'classical':
        return { icon: '📜', title: `繼續讀《${item.title}》`, desc: `讀到第 ${item.paraIndex + 1}/${item.paras} 段` }
      case 'all_done':
        return { icon: '🎉', title: '今天該做的都做完了', desc: '休息一下，或多練一輪也可以' }
    }
  }
  const cta = ctaFor(todo)

  return (
    <section className="mt-4 rounded-2xl bg-gradient-to-br from-teal-600 to-teal-700 p-5 text-white shadow-md shadow-teal-600/20">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-teal-50/90">今天</p>
        {data.streak.current > 0 && (
          <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-bold">
            🔥 連續 {data.streak.current} 天
          </span>
        )}
      </div>

      <button
        onClick={go}
        disabled={todo.kind === 'all_done'}
        className="mt-2 flex w-full items-center gap-3 rounded-xl bg-white/10 p-3 text-left transition active:scale-[0.98] disabled:active:scale-100"
      >
        <span className="text-3xl">{cta.icon}</span>
        <span className="flex-1">
          <span className="block text-lg font-bold">{cta.title}</span>
          {cta.desc && <span className="block text-sm text-teal-50/80">{cta.desc}</span>}
        </span>
        {todo.kind !== 'all_done' && <span className="text-xl text-teal-100">→</span>}
      </button>
    </section>
  )
}
