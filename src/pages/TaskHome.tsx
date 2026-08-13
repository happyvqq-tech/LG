import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import ErrorBank from '../components/ErrorBank'
import { useProfile } from '../lib/profileContext'
import { callClaudeJSON, ClaudeError } from '../lib/claude'
import { isTaskJson, type TaskGeneratorInput } from '../lib/prompts/taskGenerator'
import { createTask, getTodayPendingTask, setActiveTaskId } from '../lib/taskService'
import { downloadIcs } from '../lib/ics'
import { pickScenario } from '../lib/scenarioPool'
import { getWordsForTask } from '../lib/vocabService'
import Avatar from '../components/Avatar'
import TodayDashboard from '../components/TodayDashboard'
import LevelAdvice from '../components/LevelAdvice'
import AppVersion from '../components/AppVersion'
import { TAIGI_ENABLED } from '../lib/features'
import { isTaskLanguage, LEVEL_INFO, WEEKDAY_LABELS, type ErrorRecord, type GrammarPoint, type Language, type Task, type TaskJson, type TaskLanguage } from '../lib/types'

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
    () => (profile?.languages ?? []).filter(isTaskLanguage),
    [profile],
  )
  const [language, setLanguage] = useState<TaskLanguage>(learnable[0] ?? '英文')
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

  // 成員可能只選了古文（沒有任何走聽說讀寫循環的語言），這種情況下完全
  // 沒有「今日任務」這回事——之前 language 會默默 fallback 成英文，
  // 底下還是會生成/讀取一個使用者從沒選過的英文任務，見複盤報告
  const hasTaskLanguage = learnable.length > 0

  useEffect(() => {
    if (!profile || !hasTaskLanguage) {
      setLoading(false)
      return
    }
    setLoading(true)
    setErrorMsg('')
    getTodayPendingTask(profile.id, language)
      .then(setTask)
      .catch((e: unknown) => setErrorMsg(`讀取今日任務失敗：${String((e as Error).message)}`))
      .finally(() => setLoading(false))
  }, [profile, language, hasTaskLanguage])

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

      // 2-1. 還在 active 的錯誤 ≤ 3 筆，本次任務要刻意製造用得到該句型的情境。
      // 沒有製造機會就不算「沒再犯」（見 lib/errorRules.ts 的說明）。
      // 取最舊的：等最久的先被考，錯誤才會輪替而不是永遠卡在同幾個。
      const { data: expData, error: expError } = await supabase
        .from('errors')
        .select('*')
        .eq('profile_id', profile.id)
        .eq('language', language)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(3)
      if (expError) throw new Error(expError.message)
      const exposureErrors = (expData ?? []) as ErrorRecord[]

      // 3. 情境：多半取自成員情境池，偶爾（15%）換成一個「意料之外」的場合。
      // 六個常規類別都是順利的日常，但真實能力是在摩擦中被考驗的（見 lib/scenarioPool.ts）
      const { scenario, surprise } = pickScenario(profile.scenario_pool, Math.random(), Math.random())

      // 4. 單字庫中複習中的字，讓任務自然帶到（學了馬上用得到）
      const vocabWords = await getWordsForTask(profile.id, language)

      const taskJson = await callClaudeJSON<TaskJson>(
        {
          promptModule: 'taskGenerator',
          vars: {
            language,
            level: profile.level,
            scenario,
            grammarPoints,
            pendingErrors: (errData ?? []) as ErrorRecord[],
            exposureErrors,
            vocabWords,
            // migration-012 之前的資料庫沒有這一欄，讀回來是 undefined，
            // prompt 那邊會顯示「未提供」，不會壞掉
            interests: profile.interests ?? undefined,
            surprise,
          } satisfies TaskGeneratorInput,
          messages: [{ role: 'user', content: '請生成今日任務' }],
        },
        isTaskJson,
      )
      // 記下本任務埋設驗證的錯誤，完成任務時據此推進狀態機
      taskJson.verify_error_ids = ((errData ?? []) as ErrorRecord[]).map((e) => e.id)
      // 同理記下製造了使用機會的 active 錯誤——只有這些才有資格因為「這次沒犯」而加分
      taskJson.exposure_error_ids = exposureErrors.map((e) => e.id)

      const saved = await createTask(profile.id, language as Language, taskJson)
      setTask(saved)
    } catch (e: unknown) {
      const msg = e instanceof ClaudeError ? e.friendlyMessage : `任務生成失敗：${String((e as Error).message)}`
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
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-24">
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

      <TodayDashboard profile={profile} task={task} taskLoading={loading} />

      {/* 難度建議。只在資料夠、而且訊號明確時才出現，按「先維持」兩週內不再問。
          擺在儀表板下面而不是最上面：它是偶爾出現的插話，不是每天的主線 */}
      {hasTaskLanguage && (
        <LevelAdvice profile={profile} language={language} onChanged={() => void refreshProfile()} />
      )}

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

      {hasTaskLanguage && (
      <section className="mt-6">
        <h2 className="text-lg font-bold text-slate-700">今日任務</h2>

        {loading && <p className="mt-6 text-center text-slate-400">載入中…</p>}

        {!loading && task && (
          <div className="mt-3 rounded-2xl bg-white p-6 shadow">
            <p className="text-sm font-semibold text-teal-700">
              {language}・{task.task_json.grammar_points_used.join('、') || '綜合練習'}
            </p>
            <h3 className="mt-2 break-words text-2xl font-bold">{task.task_json.scenario_title}</h3>
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
      )}

      <section className="mt-6 grid gap-3">
        {/* 五分鐘模式放最前面：連續天數斷掉通常不是因為不想學，是今天真的沒空，
            於是跳過、隔天發現斷了就放棄。這是那個台階，忙的時候要第一眼看得到。
            用琥珀色而不是白卡，讓它一眼就跟「常規入口」分得開 */}
        <Link
          to="/quick"
          className="flex w-full items-center justify-between rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200/70 active:scale-[0.98]"
        >
          <span className="flex items-center gap-3">
            <span className="text-xl">⏱️</span>
            <span className="text-left">
              <span className="block font-bold text-amber-900">今天只有 5 分鐘？</span>
              <span className="block text-sm text-amber-800/70">到期單字＋舊錯＋重聽・做完一樣算連續天數</span>
            </span>
          </span>
          <span className="text-amber-300">→</span>
        </Link>

        {/* 進步存摺：學習最大的流失原因是「感覺不到自己在進步」，
            而證據其實一直都在資料庫裡，只是以前沒有地方看得到 */}
        <Link
          to="/progress"
          className="flex w-full items-center justify-between rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
        >
          <span className="flex items-center gap-3">
            <span className="text-2xl">📈</span>
            <span className="text-left">
              <span className="block font-bold">進步存摺</span>
              <span className="block text-sm text-slate-500">累積天數・單字量・攻克的錯誤・這個月比上個月</span>
            </span>
          </span>
          <span className="text-slate-300">→</span>
        </Link>

        {/* 教材庫：過去生成的任務一直都存在 tasks 表裡，只是以前沒有入口去看，
            練完就再也翻不到了。有機會複習才對得起每天生成的內容。 */}
        <Link
          to="/archive"
          className="flex w-full items-center justify-between rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
        >
          <span className="flex items-center gap-3">
            <span className="text-2xl">🗄️</span>
            <span className="text-left">
              <span className="block font-bold">教材庫</span>
              <span className="block text-sm text-slate-500">翻閱過去的任務・重聽、重讀、看批改</span>
            </span>
          </span>
          <span className="text-slate-300">→</span>
        </Link>

        {/* 泛聽跟每日任務的精聽是兩件事：精聽建立準確度，泛聽建立自動化與語感。
            每日任務一週只有約 1,500 字的輸入，靠那個量習得不了東西 */}
        {hasTaskLanguage && (
          <Link
            to="/extensive"
            className="flex w-full items-center justify-between rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
          >
            <span className="flex items-center gap-3">
              <span className="text-2xl">🎧</span>
              <span className="text-left">
                <span className="block font-bold">泛聽</span>
                <span className="block text-sm text-slate-500">
                  長一點、簡單一點・聽個大概就好，沒有練習題
                </span>
              </span>
            </span>
            <span className="text-slate-300">→</span>
          </Link>
        )}

        <Link
          to="/vocab"
          className="flex w-full items-center justify-between rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
        >
          <span className="flex items-center gap-3">
            <span className="text-2xl">🗂️</span>
            <span className="text-left">
              <span className="block font-bold">單字庫</span>
              <span className="block text-sm text-slate-500">多益・托福・雅思・劍橋・JLPT 分級</span>
            </span>
          </span>
          <span className="text-slate-300">→</span>
        </Link>

        {/* 台語是獨立模組（聽＋跟讀），程式完成但還沒決定要不要用雅婷 TTS，
            由 lib/features.ts 的開關控制，細節見 TAIGI_MEMO.md */}
        {TAIGI_ENABLED && (
          <Link
            to="/taigi"
            className="flex w-full items-center justify-between rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
          >
            <span className="flex items-center gap-3">
              <span className="text-2xl">🧧</span>
              <span className="text-left">
                <span className="block font-bold">台語</span>
                <span className="block text-sm text-slate-500">聽 ＋ 跟讀・漢字／台羅／華語對照</span>
              </span>
            </span>
            <span className="text-slate-300">→</span>
          </Link>
        )}

        <Link
          to="/classical"
          className="flex w-full items-center justify-between rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
        >
          <span className="flex items-center gap-3">
            <span className="text-2xl">📜</span>
            <span className="text-left">
              <span className="block font-bold">古文</span>
              <span className="block text-sm text-slate-500">古文觀止 222 篇・句讀、字詞、翻譯</span>
            </span>
          </span>
          <span className="text-slate-300">→</span>
        </Link>

        {/* 這顆按鈕開的是 `language`（走聽說讀寫循環那個語言）的錯誤庫，
            只選古文的成員沒有這個語言可言——古文自己的錯誤庫在 /classical 裡有專屬入口 */}
        {hasTaskLanguage && (
          <button
            onClick={() => setShowErrorBank(true)}
            className="flex w-full items-center justify-between rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
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
        )}
      </section>

      {showErrorBank && hasTaskLanguage && (
        <ErrorBank profileId={profile.id} language={language} onClose={() => setShowErrorBank(false)} />
      )}

      <AppVersion />
    </main>
  )
}
