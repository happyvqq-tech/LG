// 單字量累積成長曲線（單一序列的折線圖）
//
// 用純 SVG 畫，不引入圖表套件：這張圖只有一條線、六個點，
// 為它裝一個幾百 KB 的函式庫並不划算，而且 CLAUDE.md 第 10 節也不希望隨便加相依。
//
// 圖表規範（依 dataviz 準則）：
//   - 單一序列 → 不放圖例，標題本身就說明了畫的是什麼
//   - 線 2px、端點圓點 r≥4 並帶 2px 白色描邊（與線交疊時仍看得清楚）
//   - 只標端點的值，不是每個點都標數字——每點都標會變成一片噪音沒人看
//   - 格線是 1px 實線的淺灰，永遠不搶戲
//   - 手機沒有 hover，改成「點一下看該月數值」，另外附純數字表格
import { useState } from 'react'
import { monthLabel, type GrowthPoint } from '../lib/progressRules'

const ACCENT = '#0d9488'
const GRID = '#e2e8f0'
const SURFACE = '#ffffff'

const W = 320
const H = 150
const PAD = { top: 16, right: 14, bottom: 22, left: 34 }

/**
 * 取一個好看的 Y 軸上限，避免出現 4713 這種刻度。
 * 級距給得細（含 3、4）是為了讓曲線盡量填滿畫面高度——只有 1/2/5 的話，
 * 310 會被拉到上限 500，曲線縮在下面六成的空間裡，看起來像沒什麼成長。
 */
function niceMax(v: number): number {
  if (v <= 0) return 10
  const mag = 10 ** Math.floor(Math.log10(v))
  for (const step of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (v <= mag * step) return mag * step
  }
  return mag * 10
}

export default function GrowthLine({ points }: { points: GrowthPoint[] }) {
  const [picked, setPicked] = useState<number | null>(null)
  const [showTable, setShowTable] = useState(false)

  if (points.length < 2) return null

  const yMax = niceMax(Math.max(...points.map((p) => p.cumulative)))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (i * plotW) / (points.length - 1)
  const y = (v: number) => PAD.top + plotH * (1 - v / yMax)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.cumulative)}`).join(' ')
  const area = `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`

  const last = points.length - 1
  const active = picked ?? last
  const activePoint = points[active]

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
      <div className="flex items-baseline justify-between">
        <h2 className="font-bold text-slate-800">單字量累積</h2>
        <button
          onClick={() => setShowTable((v) => !v)}
          className="rounded-lg px-2 text-xs font-semibold text-teal-700"
        >
          {showTable ? '看圖' : '看數字'}
        </button>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        {monthLabel(activePoint.month)}累積 {activePoint.cumulative} 個
        {activePoint.added > 0 && `・當月新增 ${activePoint.added}`}
      </p>

      {showTable ? (
        <table className="mt-3 w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="pb-1 font-medium">月份</th>
              <th className="pb-1 text-right font-medium">當月新增</th>
              <th className="pb-1 text-right font-medium">累積</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.month} className="border-t border-slate-100">
                <td className="py-1.5 text-slate-600">{monthLabel(p.month)}</td>
                <td className="py-1.5 text-right text-slate-500">{p.added > 0 ? `+${p.added}` : '—'}</td>
                <td className="py-1.5 text-right font-semibold text-slate-800">{p.cumulative}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="mt-2 w-full"
          role="img"
          aria-label={`單字量累積成長，${monthLabel(points[0].month)}到${monthLabel(points[last].month)}，目前累積 ${points[last].cumulative} 個`}
        >
          {/* 格線與 Y 軸刻度：只放 0 與上限兩條，手機上再多就變格子紙 */}
          {[0, yMax].map((v) => (
            <g key={v}>
              <line x1={PAD.left} y1={y(v)} x2={W - PAD.right} y2={y(v)} stroke={GRID} strokeWidth="1" />
              <text x={PAD.left - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="#94a3b8">
                {v}
              </text>
            </g>
          ))}

          <path d={area} fill={ACCENT} fillOpacity="0.1" />
          <path d={line} fill="none" stroke={ACCENT} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {/* 端點（或被點選的那個月）：白色描邊讓圓點壓在線上也分得出來 */}
          <circle
            cx={x(active)}
            cy={y(activePoint.cumulative)}
            r="4.5"
            fill={ACCENT}
            stroke={SURFACE}
            strokeWidth="2"
          />
          <text
            x={Math.min(x(active), W - PAD.right - 8)}
            y={Math.max(y(activePoint.cumulative) - 9, 10)}
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill="#334155"
          >
            {activePoint.cumulative}
          </text>

          {points.map((p, i) => (
            <g key={p.month}>
              <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#94a3b8">
                {monthLabel(p.month)}
              </text>
              {/* 透明的觸控區：整欄都可以點，不用準確戳中那個小圓點 */}
              <rect
                x={x(i) - plotW / (points.length - 1) / 2}
                y={0}
                width={plotW / (points.length - 1)}
                height={H}
                fill="transparent"
                onClick={() => setPicked(i)}
              />
            </g>
          ))}
        </svg>
      )}
    </section>
  )
}
