// 每日學習計畫設定：時間、時長、練習日
import { WEEKDAY_LABELS, type DailyPlan } from '../lib/types'

const MINUTE_OPTIONS = [10, 15, 20, 30]

export const DEFAULT_PLAN: DailyPlan = { time: '20:00', minutes: 15, days: [1, 2, 3, 4, 5] }

export default function DailyPlanEditor({
  plan,
  onChange,
}: {
  plan: DailyPlan | null
  onChange: (plan: DailyPlan | null) => void
}) {
  if (!plan) {
    return (
      <button
        onClick={() => onChange(DEFAULT_PLAN)}
        className="w-full rounded-xl border-2 border-dashed border-slate-300 py-3 font-semibold text-slate-500 active:border-teal-500 active:text-teal-600"
      >
        ＋ 設定每日學習提醒
      </button>
    )
  }

  function toggleDay(d: number) {
    if (!plan) return
    const days = plan.days.includes(d) ? plan.days.filter((x) => x !== d) : [...plan.days, d]
    onChange({ ...plan, days: days.sort((a, b) => a - b) })
  }

  return (
    <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
      <div className="flex items-center gap-3">
        <label className="text-sm font-semibold text-slate-600" htmlFor="plan-time">
          每天
        </label>
        <input
          id="plan-time"
          type="time"
          value={plan.time}
          onChange={(e) => onChange({ ...plan, time: e.target.value })}
          className="rounded-lg border border-slate-300 px-3 py-2 text-lg font-semibold"
        />
        <button
          onClick={() => onChange(null)}
          className="ml-auto rounded-full px-3 text-sm text-slate-400 active:bg-slate-200"
        >
          取消提醒
        </button>
      </div>

      <p className="mt-3 text-sm font-semibold text-slate-600">練習時長</p>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {MINUTE_OPTIONS.map((m) => (
          <button
            key={m}
            onClick={() => onChange({ ...plan, minutes: m })}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              plan.minutes === m ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            {m} 分鐘
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm font-semibold text-slate-600">練習日</p>
      <div className="mt-1.5 flex gap-1.5">
        {WEEKDAY_LABELS.map((label, d) => (
          <button
            key={d}
            onClick={() => toggleDay(d)}
            aria-pressed={plan.days.includes(d)}
            className={`h-11 w-11 rounded-full text-sm font-bold ${
              plan.days.includes(d) ? 'bg-teal-600 text-white' : 'bg-white text-slate-400 ring-1 ring-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {plan.days.length === 0 && <p className="mt-2 text-sm text-amber-600">請至少選一天</p>}
    </div>
  )
}
