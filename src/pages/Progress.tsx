// 進步存摺：把資料庫裡已經有、但一直沒地方看的努力攤開來
//
// 這一頁不生成任何東西、不呼叫 AI、不花 API 錢——它只是把 errors、vocab_cards、
// activity_log、vocab_quizzes、tasks 這五張表換一個角度讀出來。
//
// 之所以叫「存摺」而不是「統計」：統計是給人分析的，存摺是給人看餘額的。
// 這頁要回答的只有一個問題——「我這段時間到底有沒有變強」——
// 而語言學習最大的流失原因，就是感覺不到這件事。
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { loadProgress } from '../lib/progressService'
import {
  buildGrowth,
  buildHeatmap,
  computeMetrics,
  computeMilestones,
  computeTotals,
  highlightLine,
  rankErrorTypes,
  EMPTY_RAW,
  type ProgressRaw,
} from '../lib/progressRules'
import StatTile from '../components/StatTile'
import GrowthLine from '../components/GrowthLine'
import ActivityHeatmap from '../components/ActivityHeatmap'
import RankedBars from '../components/RankedBars'

/** '2026-03-02' → '2026 年 3 月 2 日' */
function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${y} 年 ${m} 月 ${d} 日`
}

export default function Progress() {
  const { profile } = useProfile()
  const [raw, setRaw] = useState<ProgressRaw | null>(null)
  const [hasResolvedAt, setHasResolvedAt] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  // 固定在進頁面的時刻，避免每次 render 都產生新 Date 讓所有 memo 失效
  const [now] = useState(() => new Date())

  useEffect(() => {
    if (!profile) return
    let alive = true
    setErrorMsg('')
    loadProgress(profile.id, now)
      .then((r) => {
        if (!alive) return
        setRaw(r.raw)
        setHasResolvedAt(r.hasResolvedAt)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setRaw(EMPTY_RAW)
        setErrorMsg(`讀取紀錄失敗：${String((e as Error).message)}`)
      })
    return () => {
      alive = false
    }
  }, [profile, now])

  const view = useMemo(() => {
    if (!raw) return null
    const totals = computeTotals(raw)
    const metrics = computeMetrics(raw, now)
    return {
      totals,
      metrics,
      growth: buildGrowth(raw, now),
      heatmap: buildHeatmap(raw, now),
      errorRanks: rankErrorTypes(raw, now),
      milestones: computeMilestones(totals),
      highlight: highlightLine(metrics, totals),
    }
  }, [raw, now])

  if (!profile) return null

  return (
    <main className="mx-auto max-w-xl p-6 pb-16 lg:max-w-3xl">
      <header className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-2xl font-bold">進步存摺</h1>
          <p className="mt-1 text-sm text-slate-500">{profile.name} 的累積・每天的練習都存在這裡</p>
        </div>
        <Link to="/home" className="shrink-0 rounded-full px-4 py-2 text-sm text-slate-500 active:bg-slate-100">
          返回
        </Link>
      </header>

      {errorMsg && <p className="mt-5 rounded-xl bg-red-50 p-4 text-red-600">{errorMsg}</p>}
      {view === null && !errorMsg && <p className="mt-10 text-center text-slate-400">載入中…</p>}

      {view && (
        <div className="mt-5 space-y-4">
          {/* 存摺封面。整頁只有這一個大數字（Hero），其他都是配角。
              選「學習天數」當主角是因為它對所有成員都成立（不管學哪個語言、
              練哪個模組），而且只增不減——連續天數會斷，累積天數不會。 */}
          <section className="rounded-2xl bg-gradient-to-br from-teal-600 to-teal-700 p-5 text-white shadow-md shadow-teal-600/20">
            <p className="text-sm font-semibold text-teal-50/90">累積學習天數</p>
            <p className="mt-1 text-5xl font-bold leading-none">
              {view.totals.days}
              <span className="ml-1 text-xl font-semibold text-teal-100">天</span>
            </p>
            <p className="mt-2 text-sm text-teal-50/80">
              {view.totals.since ? `從 ${longDate(view.totals.since)} 開始` : '還沒有紀錄'}
            </p>

            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/15 pt-3 text-center">
              {[
                { label: '單字', value: view.totals.vocab },
                { label: '攻克錯誤', value: view.totals.resolved },
                { label: '完成任務', value: view.totals.tasks },
              ].map((s) => (
                <div key={s.label}>
                  <p className="text-xl font-bold">{s.value}</p>
                  <p className="text-xs text-teal-50/80">{s.label}</p>
                </div>
              ))}
            </div>
          </section>

          <p className="px-1 text-sm leading-relaxed text-slate-600">{view.highlight}</p>

          {/* 本期 vs 上期 */}
          <div>
            <h2 className="px-1 font-bold text-slate-800">近 30 天</h2>
            {/* 前四項是「量」，答對率是「質」——讓它獨佔一列，
                順便補掉 5 個格子擺在 2 欄裡最後一格會孤零零掛著的問題 */}
            <div className="mt-2 grid grid-cols-2 gap-3">
              {view.metrics.map((m) => (
                <div key={m.key} className={m.key === 'accuracy' ? 'col-span-2' : ''}>
                  <StatTile metric={m} />
                </div>
              ))}
            </div>
          </div>

          {!hasResolvedAt && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
              「攻克錯誤」目前只有累積總數，還沒有本期／上期的對照——資料庫少了記錄攻克時間的欄位。
              到 Supabase 的 SQL Editor 跑一次 <code className="font-mono">supabase/migration-011.sql</code> 就會開始記錄。
            </p>
          )}

          <GrowthLine points={view.growth} />
          <ActivityHeatmap grid={view.heatmap} />
          <RankedBars rows={view.errorRanks} />

          {/* 里程碑：每條軌道只顯示「下一個搆得到的目標」。
              一次攤開十六個大多做不到的目標只會讓人覺得路很長；
              四個伸手可及的才會讓人想去搆。 */}
          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
            <h2 className="font-bold text-slate-800">下一個里程碑</h2>
            <ul className="mt-3 space-y-3">
              {view.milestones.map((m) => {
                const pct = Math.min(100, Math.round((m.current / m.target) * 100))
                return (
                  <li key={m.track}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-slate-700">
                        {m.track}
                        {m.done && <span className="ml-1.5 text-xs text-teal-700">已達成最高階 🎉</span>}
                      </span>
                      <span className="tabular-nums text-xs text-slate-500">
                        {m.current} / {m.label}
                      </span>
                    </div>
                    {/* 未填滿的軌道用同色系的淺階，整條看起來才是一個量尺 */}
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-teal-50">
                      <div className="h-full rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>

          <p className="px-1 text-xs leading-relaxed text-slate-400">
            資料範圍為近一年（單字量為全部）。這頁只是把既有紀錄換個角度呈現，不會產生新內容，也不會用到 AI 額度。
          </p>
        </div>
      )}
    </main>
  )
}
