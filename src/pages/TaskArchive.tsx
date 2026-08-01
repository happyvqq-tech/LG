// 教材庫：翻閱過去生成的任務，點進去可以反覆複習
//
// 任務本來就都存在 Supabase 的 tasks 表（含 (profile_id, created_at desc) 索引），
// 一直以來只是沒有入口去看——生成完、練完就再也找不到了。這頁就是那個入口。
//
// 只做「翻閱與複習」，不能從這裡重做寫作：舊任務的作答與批改是已經發生的紀錄，
// 讓它可以被覆寫等於把歷史弄丟了。要重練請生成新任務。
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { listPastTasks } from '../lib/taskService'
import { loadReviewedToday, markReviewed, pickReviewTasks } from '../lib/reviewSchedule'
import { isTaskLanguage, type Language, type Task } from '../lib/types'

const ALL = '__all__'

/** 2026-08-01 → 8/1（週五）；今天與昨天用文字標示，翻起來比較好定位 */
function formatDay(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const that = new Date(d)
  that.setHours(0, 0, 0, 0)
  const diffDays = Math.round((today.getTime() - that.getTime()) / 86400000)
  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getMonth() + 1}/${d.getDate()}（${weekday}）`
}

export default function TaskArchive() {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [langFilter, setLangFilter] = useState<Language | typeof ALL>(ALL)

  useEffect(() => {
    if (!profile) return
    let alive = true
    setErrorMsg('')
    listPastTasks(profile.id, null)
      .then((list) => {
        if (alive) setTasks(list)
      })
      .catch((e: unknown) => {
        if (alive) {
          setTasks([])
          setErrorMsg(`讀取教材庫失敗：${String((e as Error).message)}`)
        }
      })
    return () => {
      alive = false
    }
  }, [profile])

  /** 只列出教材裡真的出現過的語言，不要擺一排永遠是空的篩選鈕 */
  const languages = useMemo(() => {
    const seen = new Set<Language>()
    for (const t of tasks ?? []) if (isTaskLanguage(t.language)) seen.add(t.language)
    return [...seen]
  }, [tasks])

  const shown = useMemo(
    () => (tasks ?? []).filter((t) => langFilter === ALL || t.language === langFilter),
    [tasks, langFilter],
  )

  /**
   * 今天該回去重聽的。跟著語言篩選走，不然選了「日文」還是會排出英文教材。
   * now 固定在這次進頁面的時刻，避免每次 render 都產生新的 Date 讓 memo 失效。
   */
  const [now] = useState(() => new Date())
  const [reviewed, setReviewed] = useState<Set<string>>(() => loadReviewedToday(new Date()))
  const reviewPicks = useMemo(() => pickReviewTasks(shown, now), [shown, now])

  function openReview(taskId: string) {
    markReviewed(taskId, now)
    setReviewed(loadReviewedToday(now))
    navigate(`/archive/${taskId}`)
  }

  if (!profile) return null

  return (
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-16">
      <header className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-2xl font-bold">教材庫</h1>
          <p className="mt-1 text-sm text-slate-500">
            過去生成的任務都留著，點進去可以重聽、重讀、看批改
          </p>
        </div>
        <Link
          to="/home"
          className="shrink-0 rounded-full px-4 py-2 text-sm text-slate-500 active:bg-slate-100"
        >
          返回
        </Link>
      </header>

      {languages.length > 1 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {([ALL, ...languages] as Array<Language | typeof ALL>).map((l) => (
            <button
              key={l}
              onClick={() => setLangFilter(l)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                langFilter === l ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 shadow-sm'
              }`}
            >
              {l === ALL ? '全部' : l}
            </button>
          ))}
        </div>
      )}

      {errorMsg && <p className="mt-5 rounded-xl bg-red-50 p-4 text-red-600">{errorMsg}</p>}

      {tasks === null && <p className="mt-10 text-center text-slate-400">載入中…</p>}

      {tasks !== null && shown.length === 0 && !errorMsg && (
        <div className="mt-10 rounded-2xl bg-white p-8 text-center shadow-sm">
          <p className="text-4xl">📚</p>
          <p className="mt-3 font-semibold text-slate-600">
            {tasks.length === 0 ? '還沒有任何教材' : '這個語言還沒有教材'}
          </p>
          <p className="mt-1 text-sm text-slate-400">回首頁生成今日任務，之後就會累積在這裡</p>
          <button
            onClick={() => navigate('/home')}
            className="mt-5 rounded-xl bg-teal-600 px-6 py-3 font-bold text-white"
          >
            回首頁
          </button>
        </div>
      )}

      {reviewPicks.length > 0 && (
        <section className="mt-6 rounded-3xl bg-teal-50/70 p-5 ring-1 ring-teal-100">
          <h2 className="font-bold text-teal-800">🔁 今天回去聽這幾篇</h2>
          <p className="mt-1 text-xs leading-relaxed text-teal-700">
            隔一段時間再聽一次，記得的時間會拉長好幾倍。不用重做練習，聽過就好——
            通勤、洗碗的時候放著也算。
          </p>
          <div className="mt-3 grid gap-2">
            {reviewPicks.map((p) => {
              const done = reviewed.has(p.task.id)
              return (
                <button
                  key={p.task.id}
                  onClick={() => openReview(p.task.id)}
                  className={`flex items-center gap-3 rounded-2xl p-4 text-left transition active:scale-[0.98] ${
                    done ? 'bg-white/60' : 'bg-white shadow-sm'
                  }`}
                >
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg ${
                      done ? 'bg-green-100' : 'bg-teal-100'
                    }`}
                  >
                    {done ? '✓' : '🎧'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-teal-700">
                      {p.label}・{p.task.language}
                    </span>
                    <span
                      className={`mt-0.5 block break-words font-semibold ${
                        done ? 'text-slate-400' : ''
                      }`}
                    >
                      {p.task.task_json.scenario_title}
                    </span>
                  </span>
                  <span className="text-slate-300">→</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {shown.length > 0 && (
        <h2 className="mt-6 text-sm font-bold text-slate-500">全部教材（{shown.length}）</h2>
      )}

      <div className="mt-2 grid gap-3">
        {shown.map((t) => (
          <Link
            key={t.id}
            to={`/archive/${t.id}`}
            className="block rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
          >
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className="text-slate-400">{formatDay(t.created_at)}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
                {t.language}
              </span>
              {t.status === 'done' ? (
                <span className="rounded-full bg-green-50 px-2 py-0.5 text-green-700">已完成</span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">未完成</span>
              )}
              {t.task_json.grading && (
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">有批改</span>
              )}
            </div>
            <p className="mt-2 break-words font-bold">{t.task_json.scenario_title}</p>
            <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">
              {t.task_json.scenario_desc}
            </p>
            {t.task_json.grammar_points_used.length > 0 && (
              <p className="mt-1.5 text-xs text-teal-700">
                {t.task_json.grammar_points_used.join('、')}
              </p>
            )}
          </Link>
        ))}
      </div>
    </main>
  )
}
