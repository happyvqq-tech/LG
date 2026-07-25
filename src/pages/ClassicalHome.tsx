import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProfile } from '../lib/profileContext'
import { getAllProgress, summarize } from '../lib/classicalService'
import { getDueParticleCount } from '../lib/particleService'
import ErrorBank from '../components/ErrorBank'
import {
  CLASSICAL_INDEX,
  CLASSICAL_LEVELS,
  CLASSICAL_LEVEL_INFO,
  EIGHT_MASTERS,
  type ClassicalLevel,
} from '../data/classicalIndex'
import type { ClassicalProgress } from '../lib/types'

type MasterFilter = 'all' | (typeof EIGHT_MASTERS)[number]

export default function ClassicalHome() {
  const navigate = useNavigate()
  const { profile, refreshProfile } = useProfile()

  const [progress, setProgress] = useState<Record<string, ClassicalProgress>>({})
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [level, setLevel] = useState<ClassicalLevel>('入門')
  const [master, setMaster] = useState<MasterFilter>('all')
  const [savingLevel, setSavingLevel] = useState(false)
  const [showErrorBank, setShowErrorBank] = useState(false)
  const [particleDue, setParticleDue] = useState(0)

  // 成員設定過古文程度就用它當預設起點
  useEffect(() => {
    const saved = profile?.classical_level
    if (saved && (CLASSICAL_LEVELS as string[]).includes(saved)) {
      setLevel(saved as ClassicalLevel)
    }
  }, [profile?.classical_level])

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setErrorMsg('')
    try {
      setProgress(await getAllProgress(profile.id))
    } catch (e: unknown) {
      setErrorMsg(`讀取進度失敗：${String((e as Error).message)}`)
    } finally {
      setLoading(false)
    }
  }, [profile])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!profile) return
    getDueParticleCount(profile.id).then(setParticleDue).catch(() => undefined)
  }, [profile])

  const stats = useMemo(() => summarize(progress), [progress])

  const shown = useMemo(
    () =>
      CLASSICAL_INDEX.filter(
        (e) => e.level === level && (master === 'all' || e.eightMaster === master),
      ),
    [level, master],
  )

  async function pickLevel(next: ClassicalLevel) {
    setLevel(next)
    if (!profile || profile.classical_level === next) return
    // 記住這位成員的程度，下次進來直接落在同一級
    setSavingLevel(true)
    await supabase.from('profiles').update({ classical_level: next }).eq('id', profile.id)
    await refreshProfile()
    setSavingLevel(false)
  }

  if (!profile) return null

  return (
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-24">
      <button
        onClick={() => navigate('/home')}
        className="-ml-2 flex items-center gap-1 rounded-full px-2 text-sm font-semibold text-slate-500 active:bg-slate-100"
      >
        ← 回首頁
      </button>

      <header className="mt-1">
        <h1 className="text-2xl font-bold">古文</h1>
        <p className="mt-1 text-sm text-slate-500">
          《古文觀止》全 222 篇・唐宋八大家 77 篇
        </p>
      </header>

      <section className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200/60">
          <p className="text-2xl font-bold text-teal-700">{stats.done}</p>
          <p className="mt-0.5 text-xs text-slate-500">已讀完</p>
        </div>
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200/60">
          <p className="text-2xl font-bold text-amber-600">{stats.started}</p>
          <p className="mt-0.5 text-xs text-slate-500">讀到一半</p>
        </div>
        <div className="rounded-2xl bg-white p-4 text-center shadow-sm ring-1 ring-slate-200/60">
          <p className="text-2xl font-bold text-slate-400">{stats.total}</p>
          <p className="mt-0.5 text-xs text-slate-500">全部篇數</p>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3">
        <button
          onClick={() => navigate('/classical/particles')}
          className="flex flex-col items-start rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/60 active:scale-95"
        >
          <span className="text-2xl">🈁</span>
          <span className="mt-1 font-bold">虛詞專練</span>
          <span className="text-xs text-slate-500">
            {particleDue > 0 ? `${particleDue} 個待複習` : '18 個核心虛詞'}
          </span>
        </button>
        <button
          onClick={() => setShowErrorBank(true)}
          className="flex flex-col items-start rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/60 active:scale-95"
        >
          <span className="text-2xl">📚</span>
          <span className="mt-1 font-bold">錯誤庫</span>
          <span className="text-xs text-slate-500">翻譯批改累積的錯誤</span>
        </button>
      </section>

      {/* 分級 */}
      <div className="mt-5 flex flex-wrap gap-2">
        {CLASSICAL_LEVELS.map((lv) => (
          <button
            key={lv}
            onClick={() => void pickLevel(lv)}
            disabled={savingLevel}
            className={`rounded-full px-4 py-2 font-semibold transition ${
              level === lv ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            {lv}
          </button>
        ))}
      </div>
      <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 ring-1 ring-slate-200/70">
        {CLASSICAL_LEVEL_INFO[level].desc}
      </p>

      {/* 八大家篩選 */}
      <div className="mt-4 -mx-6 overflow-x-auto px-6">
        <div className="flex w-max gap-2">
          <button
            onClick={() => setMaster('all')}
            className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
              master === 'all' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            全部
          </button>
          {EIGHT_MASTERS.map((m) => (
            <button
              key={m}
              onClick={() => setMaster(master === m ? 'all' : m)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
                master === m ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="mt-10 text-center text-slate-400">載入中…</p>}
      {errorMsg && (
        <div className="mt-6 rounded-2xl bg-red-50 p-4 text-red-600">
          {errorMsg}
          <button
            onClick={() => void load()}
            className="mt-3 block w-full rounded-xl bg-red-600 px-4 py-2 font-semibold text-white"
          >
            重試
          </button>
        </div>
      )}

      {!loading && shown.length === 0 && (
        <p className="mt-10 text-center text-slate-400">
          這個程度沒有{master === 'all' ? '' : `${master}的`}篇目，換個篩選看看
        </p>
      )}

      <div className="mt-4 grid gap-2">
        {shown.map((e) => {
          const p = progress[e.id]
          const done = p?.status === 'done'
          return (
            <button
              key={e.id}
              onClick={() => navigate(`/classical/${e.id}`)}
              className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200/60 transition active:scale-[0.98]"
            >
              <span className="flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-lg font-bold">{e.title}</span>
                  {done && (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                      已讀完
                    </span>
                  )}
                  {!done && p && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                      第 {p.para_index + 1}/{e.paras} 段
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-sm text-slate-500">
                  {e.source}・{e.era}・{e.chars} 字
                </span>
                {p && (p.punctuation_best > 0 || p.translation_best > 0) && (
                  <span className="mt-1 block text-xs text-slate-400">
                    {p.punctuation_best > 0 && `句讀 ${Math.round(p.punctuation_best * 100)}%`}
                    {p.punctuation_best > 0 && p.translation_best > 0 && '・'}
                    {p.translation_best > 0 && `翻譯 ${p.translation_best} 分`}
                  </span>
                )}
              </span>
              <span className="text-slate-300">→</span>
            </button>
          )
        })}
      </div>

      {showErrorBank && (
        <ErrorBank profileId={profile.id} language="古文" onClose={() => setShowErrorBank(false)} />
      )}
    </main>
  )
}
