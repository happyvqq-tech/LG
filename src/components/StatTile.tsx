// 一個指標的「本期 vs 上期」小卡
//
// 為什麼一定要有對照：「這個月練了 18 天」本身沒有訊息量，人不知道 18 算多還少。
// 「18 天，比上個月多 4 天」才構成一個判斷。單一數字只會被瞄過，
// 帶方向的數字會被讀進去。
import type { Metric } from '../lib/progressRules'

/** 箭頭顏色＝變化方向 × 這個方向是不是好事（目前所有指標都是越大越好，但不寫死） */
function deltaTone(diff: number, upIsGood: boolean): string {
  if (diff === 0) return 'text-slate-400'
  const good = diff > 0 === upIsGood
  return good ? 'text-emerald-600' : 'text-orange-600'
}

export default function StatTile({ metric }: { metric: Metric }) {
  const diff = metric.value - metric.prev
  const sign = diff > 0 ? '+' : ''

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
      <p className="text-xs text-slate-500">{metric.label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-800">
        {metric.value}
        <span className="ml-0.5 text-sm font-semibold text-slate-400">{metric.unit}</span>
      </p>
      {metric.noBaseline ? (
        // 上期沒有資料就誠實顯示「—」。第一次用的人看到「成長 100%」只會覺得
        // 這個 App 在灌水，之後所有數字都不會再被相信
        <p className="mt-0.5 text-xs text-slate-400">還沒有上期可比</p>
      ) : (
        <p className={`mt-0.5 text-xs font-semibold ${deltaTone(diff, metric.upIsGood)}`}>
          {diff === 0 ? '跟上期一樣' : `${diff > 0 ? '↑' : '↓'} ${sign}${diff}${metric.unit} vs 上期`}
        </p>
      )}
    </div>
  )
}
