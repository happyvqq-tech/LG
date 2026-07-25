// 測驗成績趨勢：純 SVG 折線圖，不引入圖表套件
import type { QuizRecord } from '../lib/types'

const W = 300
const H = 80
const PAD = 6

export default function QuizTrend({ history }: { history: QuizRecord[] }) {
  // history 是新到舊，畫圖要舊到新
  const points = [...history].reverse().map((h) => ({
    pct: h.total > 0 ? (h.score / h.total) * 100 : 0,
    date: h.quiz_date,
  }))

  if (points.length === 0) return null

  const latest = points[points.length - 1]
  const best = Math.max(...points.map((p) => p.pct))
  const avg = points.reduce((s, p) => s + p.pct, 0) / points.length

  const x = (i: number) => (points.length === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (points.length - 1))
  const y = (pct: number) => H - PAD - (pct / 100) * (H - PAD * 2)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H} L${x(0).toFixed(1)},${H} Z`

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <div className="flex items-baseline justify-between">
        <h2 className="font-bold text-slate-700">測驗趨勢</h2>
        <span className="text-sm text-slate-400">最近 {points.length} 次</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-3 h-20 w-full"
        role="img"
        aria-label={`測驗正確率趨勢，最近一次 ${Math.round(latest.pct)}%`}
      >
        {[0, 50, 100].map((g) => (
          <line
            key={g}
            x1={0}
            x2={W}
            y1={y(g)}
            y2={y(g)}
            stroke="currentColor"
            className="text-slate-100"
            strokeWidth={1}
          />
        ))}
        <path d={area} className="fill-teal-500/10" />
        <path d={line} fill="none" className="stroke-teal-500" strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.pct)}
            r={i === points.length - 1 ? 4 : 2.5}
            className={i === points.length - 1 ? 'fill-teal-600' : 'fill-teal-400'}
          />
        ))}
      </svg>

      <div className="mt-2 grid grid-cols-3 text-center">
        <div>
          <p className="text-lg font-bold text-teal-700">{Math.round(latest.pct)}%</p>
          <p className="text-xs text-slate-400">最近一次</p>
        </div>
        <div>
          <p className="text-lg font-bold text-slate-600">{Math.round(avg)}%</p>
          <p className="text-xs text-slate-400">平均</p>
        </div>
        <div>
          <p className="text-lg font-bold text-green-600">{Math.round(best)}%</p>
          <p className="text-xs text-slate-400">最佳</p>
        </div>
      </div>
    </div>
  )
}
