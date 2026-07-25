import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProfile } from '../lib/profileContext'
import { getVocabStats, type VocabStats } from '../lib/vocabService'
import { getQuizHistory, takenToday } from '../lib/quizService'
import QuizTrend from '../components/QuizTrend'
import type { QuizRecord } from '../lib/types'
import { EXAM_OPTIONS, examLanguage, type ExamSystem } from '../data/vocabLists'
import { DEFAULT_VOCAB_PREF, type Language, type VocabPref } from '../lib/types'

const DAILY_NEW_OPTIONS = [5, 10, 15, 20]

export default function VocabHome() {
  const navigate = useNavigate()
  const { profile, refreshProfile } = useProfile()
  const [stats, setStats] = useState<VocabStats | null>(null)
  const [history, setHistory] = useState<QuizRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [showSettings, setShowSettings] = useState(false)

  const pref: VocabPref = profile?.vocab_pref ?? DEFAULT_VOCAB_PREF
  const language: Language = examLanguage(pref.exam as ExamSystem)

  const loadStats = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setErrorMsg('')
    try {
      const [s, h] = await Promise.all([
        getVocabStats(profile.id, language),
        // 測驗紀錄讀不到不該擋住主畫面（例如還沒跑 migration-004）
        getQuizHistory(profile.id, language).catch(() => [] as QuizRecord[]),
      ])
      setStats(s)
      setHistory(h)
    } catch (e: unknown) {
      setErrorMsg(`讀取單字進度失敗：${String((e as Error).message)}`)
    } finally {
      setLoading(false)
    }
  }, [profile, language])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  if (!profile) return null

  const canStart = (stats?.due ?? 0) > 0 || pref.daily_new > 0
  const todayResult = takenToday(history)

  return (
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-24">
      <button
        onClick={() => navigate('/home')}
        className="-ml-2 flex items-center gap-1 rounded-full px-2 text-sm font-semibold text-slate-500 active:bg-slate-100"
      >
        ← 回首頁
      </button>

      <header className="mt-1 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">單字庫</h1>
          <p className="mt-1 text-sm text-slate-500">
            {pref.exam} {pref.exam_level}・每日新字 {pref.daily_new} 個
          </p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="rounded-full px-3 py-2 text-sm font-semibold text-teal-700 active:bg-teal-50"
        >
          ⚙️ 設定
        </button>
      </header>

      {loading && <p className="mt-10 text-center text-slate-400">載入中…</p>}

      {errorMsg && (
        <div className="mt-6 rounded-2xl bg-red-50 p-4 text-red-600">
          {errorMsg}
          <button
            onClick={() => void loadStats()}
            className="mt-3 block w-full rounded-xl bg-red-600 px-4 py-2 font-semibold text-white"
          >
            重試
          </button>
        </div>
      )}

      {!loading && stats && (
        <>
          <section className="mt-5 grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200/60">
              <p className="text-3xl font-bold text-amber-600">{stats.due}</p>
              <p className="mt-0.5 text-xs text-slate-500">今天要複習</p>
            </div>
            <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200/60">
              <p className="text-3xl font-bold text-teal-700">{stats.learning}</p>
              <p className="mt-0.5 text-xs text-slate-500">學習中</p>
            </div>
            <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200/60">
              <p className="text-3xl font-bold text-green-600">{stats.mastered}</p>
              <p className="mt-0.5 text-xs text-slate-500">已學會</p>
            </div>
          </section>

          <button
            onClick={() => navigate('/vocab/session')}
            disabled={!canStart}
            className="mt-5 w-full rounded-2xl bg-teal-600 py-4 text-lg font-bold text-white shadow-md shadow-teal-600/25 active:scale-95 disabled:opacity-50"
          >
            {stats.due > 0 ? `開始複習（${stats.due} 個到期）` : `學新字（${pref.daily_new} 個）`}
          </button>

          {stats.due === 0 && stats.total > 0 && pref.daily_new > 0 && (
            <p className="mt-3 rounded-2xl bg-green-50 p-4 text-center text-green-700 ring-1 ring-green-100">
              🎉 今天的複習都完成了，可以直接學新字
            </p>
          )}

          {stats.due === 0 && pref.daily_new === 0 && (
            <div className="mt-3 rounded-2xl bg-amber-50 p-4 text-center text-amber-700 ring-1 ring-amber-100">
              <p>今天的複習都完成了，但每日新字設定是 0 個，暫時沒有新字可學</p>
              <button
                onClick={() => setShowSettings(true)}
                className="mt-2 rounded-full bg-white px-4 py-1.5 text-sm font-semibold text-amber-700 ring-1 ring-amber-200"
              >
                ⚙️ 去設定調高每日新字量
              </button>
            </div>
          )}

          {stats.total === 0 && (
            <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
              <h2 className="font-bold text-slate-700">怎麼學才記得住</h2>
              <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-slate-600">
                <li>
                  <b className="text-teal-700">五關卡</b>
                  ：每個字要通過 初見 → 認詞 → 回想 → 聽辨 → 產出，同一個字用不同方式碰過才算學會
                </li>
                <li>
                  <b className="text-teal-700">間隔重複</b>
                  ：答完自評難易，系統自動算出下次該複習的日子（1 → 3 → 7 → 15 → 30 天…）
                </li>
                <li>
                  <b className="text-teal-700">別求快</b>
                  ：每天 {pref.daily_new} 個新字 + 到期複習，約 8-12 分鐘，天天做比一次狂背有效得多
                </li>
              </ul>
            </div>
          )}

          {/* 每日測驗 */}
          <button
            onClick={() => navigate('/vocab/quiz')}
            className="mt-4 flex w-full items-center justify-between rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
          >
            <span className="flex items-center gap-3">
              <span className="text-2xl">📝</span>
              <span className="text-left">
                <span className="block font-bold">
                  每日測驗
                  {todayResult && (
                    <span className="ml-2 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                      今天 {todayResult.score}/{todayResult.total}
                    </span>
                  )}
                </span>
                <span className="block text-sm text-slate-500">
                  {todayResult ? '已完成，可以再測一次（不覆蓋紀錄）' : '全新句子填空，檢測是不是真的會用'}
                </span>
              </span>
            </span>
            <span className="text-slate-300">→</span>
          </button>

          {history.length > 0 && (
            <div className="mt-4">
              <QuizTrend history={history} />
            </div>
          )}

          <Link
            to="/vocab/list"
            className="mt-4 flex w-full items-center justify-between rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
          >
            <span className="flex items-center gap-3">
              <span className="text-2xl">📇</span>
              <span className="text-left">
                <span className="block font-bold">我的單字（{stats.total}）</span>
                <span className="block text-sm text-slate-500">看全部、聽發音、查進度</span>
              </span>
            </span>
            <span className="text-slate-300">→</span>
          </Link>
        </>
      )}

      {showSettings && (
        <SettingsDrawer
          profileId={profile.id}
          pref={pref}
          onClose={() => setShowSettings(false)}
          onSaved={async () => {
            setShowSettings(false)
            await refreshProfile()
          }}
        />
      )}
    </main>
  )
}

function SettingsDrawer({
  profileId,
  pref,
  onClose,
  onSaved,
}: {
  profileId: string
  pref: VocabPref
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [exam, setExam] = useState(pref.exam)
  const [examLevel, setExamLevel] = useState(pref.exam_level)
  const [dailyNew, setDailyNew] = useState(pref.daily_new)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const current = useMemo(() => EXAM_OPTIONS.find((o) => o.exam === exam), [exam])

  function pickExam(next: ExamSystem) {
    setExam(next)
    const option = EXAM_OPTIONS.find((o) => o.exam === next)
    // 換考試時等級要一併切到該考試的第一級，避免殘留無效值
    if (option) setExamLevel(option.levels[0].id)
  }

  async function save() {
    setSaving(true)
    setSaveError('')
    const next: VocabPref = { exam, exam_level: examLevel, daily_new: dailyNew }
    const { error } = await supabase.from('profiles').update({ vocab_pref: next }).eq('id', profileId)
    setSaving(false)
    if (error) {
      setSaveError(`儲存失敗：${error.message}`)
      return
    }
    await onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200" />
        <h2 className="mt-4 text-xl font-bold">單字設定</h2>

        <p className="mt-5 text-sm font-semibold text-slate-600">考試</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAM_OPTIONS.map((o) => (
            <button
              key={o.exam}
              onClick={() => pickExam(o.exam)}
              className={`rounded-full px-4 py-2.5 font-semibold transition ${
                exam === o.exam ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {o.exam}
              <span className="ml-1 text-xs opacity-70">{o.language}</span>
            </button>
          ))}
        </div>

        <p className="mt-5 text-sm font-semibold text-slate-600">目標等級</p>
        <div className="mt-2 grid gap-2">
          {(current?.levels ?? []).map((lv) => (
            <button
              key={lv.id}
              onClick={() => setExamLevel(lv.id)}
              className={`rounded-xl px-4 py-3 text-left transition ${
                examLevel === lv.id
                  ? 'bg-teal-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span className="font-bold">{lv.label}</span>
              <span className={`ml-2 text-sm ${examLevel === lv.id ? 'opacity-80' : 'text-slate-400'}`}>
                {lv.hint}
              </span>
            </button>
          ))}
        </div>

        <p className="mt-5 text-sm font-semibold text-slate-600">每日新字量</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DAILY_NEW_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => setDailyNew(n)}
              className={`rounded-full px-5 py-2.5 font-semibold ${
                dailyNew === n ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {n} 個
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          新字會累積成之後的複習量，建議先從 10 個開始，覺得太輕鬆再加
        </p>

        {saveError && <p className="mt-4 rounded-xl bg-red-50 p-3 text-red-600">{saveError}</p>}

        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl bg-slate-100 py-3 font-semibold text-slate-600">
            取消
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="flex-1 rounded-xl bg-teal-600 py-3 font-semibold text-white disabled:opacity-50"
          >
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}
