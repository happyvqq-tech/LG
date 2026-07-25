import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ErrorBank from '../components/ErrorBank'
import { useProfile } from '../lib/profileContext'
import { callClaudeJSON, ClaudeError } from '../lib/claude'
import { taskGeneratorSystemPrompt, isTaskJson } from '../lib/prompts/taskGenerator'
import { createTask, getTodayPendingTask, setActiveTaskId } from '../lib/taskService'
import { downloadIcs } from '../lib/ics'
import Avatar from '../components/Avatar'
import { LEVEL_INFO, WEEKDAY_LABELS, type ErrorRecord, type GrammarPoint, type Language, type Task, type TaskJson } from '../lib/types'

function pickRandom<T>(list: T[], count: number): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, count)
}

export default function TaskHome() {
  const navigate = useNavigate()
  const { profile, refreshProfile } = useProfile()
  const learnable = useMemo(
    () => (profile?.languages ?? []).filter((l): l is '英文' | '日文' => l === '英文' || l === '日文'),
    [profile],
  )
  const [language, setLanguage] = useState<'英文' | '日文'>(learnable[0] ?? '英文')
  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [showErrorBank, setShowErrorBank] = useState(false)

  // 進頁面時同步一次成員資料（其他裝置改過名稱/照片/計畫時跟上）
  useEffect(() => {
    void refreshProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!profile) return
    setLoading(true)
    setErrorMsg('')
    getTodayPendingTask(profile.id, language)
      .then(setTask)
      .catch((e: unknown) => setErrorMsg(`讀取今日任務失敗：${String((e as Error).message)}`))
      .finally(() => setLoading(false))
  }, [profile, language])

  async function generate() {
    if (!profile) return
    setGenerating(true)
    setErrorMsg('')
    try {
      // 1. 輪替中的文法點 1-2 個（無輪替設定時退回隨機挑選）
      const { data: gpData, error: gpError } = await supabase
        .from('grammar_points')
        .select('*')
        .eq('language', language)
      if (gpError) throw new Error(gpError.message)
      const all = (gpData ?? []) as GrammarPoint[]
      const rotation = all.filter((g) => g.in_rotation)
      const grammarPoints = pickRandom(rotation.length > 0 ? rotation : all, 2)
      if (grammarPoints.length === 0) throw new Error('沒有文法點資料，請先執行 seed.sql')

      // 2. 待驗證錯誤 ≤ 3 筆
      const { data: errData, error: errError } = await supabase
        .from('errors')
        .select('*')
        .eq('profile_id', profile.id)
        .eq('language', language)
        .eq('status', 'pending_verify')
        .limit(3)
      if (errError) throw new Error(errError.message)

      // 3. 情境隨機取自成員情境池
      const scenario = pickRandom(profile.scenario_pool.length > 0 ? profile.scenario_pool : ['日常'], 1)[0]

      const system = taskGeneratorSystemPrompt({
        language,
        level: profile.level,
        scenario,
        grammarPoints,
        pendingErrors: (errData ?? []) as ErrorRecord[],
      })
      const taskJson = await callClaudeJSON<TaskJson>(
        { module: 'taskGenerator', system, messages: [{ role: 'user', content: '請生成今日任務' }] },
        isTaskJson,
      )
      // 記下本任務埋設驗證的錯誤，完成任務時據此推進狀態機
      taskJson.verify_error_ids = ((errData ?? []) as ErrorRecord[]).map((e) => e.id)

      const saved = await createTask(profile.id, language as Language, taskJson)
      setTask(saved)
    } catch (e: unknown) {
      const msg = e instanceof ClaudeError ? e.message : `任務生成失敗：${String((e as Error).message)}`
      setErrorMsg(msg)
    } finally {
      setGenerating(false)
    }
  }

  function goToSkill(path: string) {
    if (!task) return
    setActiveTaskId(task.id)
    navigate(path)
  }

  if (!profile) return null

  return (
    <main className="mx-auto max-w-xl p-6 pb-24">
      <header className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-3">
          <Avatar profile={profile} size="sm" />
          <div>
            <p className="font-bold">{profile.name}</p>
            <p className="text-sm text-slate-500">
              {profile.level} {LEVEL_INFO[profile.level]?.label ?? ''}
            </p>
          </div>
        </div>
        <Link to="/" className="rounded-full px-4 py-2 text-sm text-slate-500 active:bg-slate-100">
          換人
        </Link>
      </header>

      {profile.daily_plan && profile.daily_plan.days.length > 0 && (
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
          <span className="text-xl">⏰</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-700">
              今日計畫 {profile.daily_plan.time}・{profile.daily_plan.minutes} 分鐘
            </p>
            <p className="text-xs text-slate-400">
              練習日：{profile.daily_plan.days.map((d) => WEEKDAY_LABELS[d]).join('、')}
            </p>
          </div>
          <button
            onClick={() => downloadIcs(profile, profile.daily_plan!)}
            className="rounded-xl bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700"
          >
            📅 加入行事曆
          </button>
        </div>
      )}

      {learnable.length > 1 && (
        <div className="mt-5 flex gap-2">
          {learnable.map((l) => (
            <button
              key={l}
              onClick={() => setLanguage(l)}
              className={`rounded-full px-5 py-2 font-semibold ${
                language === l ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 shadow-sm'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-bold text-slate-700">今日任務</h2>

        {loading && <p className="mt-6 text-center text-slate-400">載入中…</p>}

        {!loading && task && (
          <div className="mt-3 rounded-2xl bg-white p-6 shadow">
            <p className="text-sm font-semibold text-teal-700">
              {language}・{task.task_json.grammar_points_used.join('、') || '綜合練習'}
            </p>
            <h3 className="mt-2 text-2xl font-bold">{task.task_json.scenario_title}</h3>
            <p className="mt-2 text-slate-600">{task.task_json.scenario_desc}</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {([
                { label: '聽力', icon: '🎧', path: '/listening' },
                { label: '閱讀', icon: '📖', path: '/reading' },
                { label: '口說', icon: '🗣️', path: '/speaking' },
                { label: '寫作', icon: '✍️', path: '/writing' },
              ] as const).map((s) => (
                <button
                  key={s.path}
                  onClick={() => goToSkill(s.path)}
                  className="flex items-center gap-3 rounded-xl bg-teal-50 px-4 py-4 text-left font-semibold text-teal-800 shadow-sm transition active:scale-95 active:bg-teal-100"
                >
                  <span className="text-2xl">{s.icon}</span>
                  {s.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => goToSkill('/listening')}
              className="mt-3 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-95"
            >
              從頭開始（聽→讀→說→寫）
            </button>
          </div>
        )}

        {!loading && !task && (
          <div className="mt-3 rounded-2xl bg-white p-6 text-center shadow">
            <p className="text-slate-500">今天還沒有任務</p>
            <button
              onClick={() => void generate()}
              disabled={generating}
              className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
            >
              {generating ? '生成中，約需 10 秒…' : '生成任務'}
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="mt-3 rounded-xl bg-red-50 p-4 text-red-600">
            {errorMsg}
            <button
              onClick={() => void generate()}
              disabled={generating}
              className="mt-3 block w-full rounded-lg bg-red-600 px-4 py-2 font-semibold text-white disabled:opacity-60"
            >
              重試
            </button>
          </div>
        )}
      </section>

      <section className="mt-6">
        <button
          onClick={() => setShowErrorBank(true)}
          className="flex w-full items-center justify-between rounded-2xl bg-white p-5 shadow active:scale-[0.98]"
        >
          <span className="flex items-center gap-3">
            <span className="text-2xl">📚</span>
            <span className="text-left">
              <span className="block font-bold">錯誤庫</span>
              <span className="block text-sm text-slate-500">學習中・驗證中・已攻克</span>
            </span>
          </span>
          <span className="text-slate-300">→</span>
        </button>
      </section>

      {showErrorBank && (
        <ErrorBank profileId={profile.id} language={language} onClose={() => setShowErrorBank(false)} />
      )}
    </main>
  )
}
