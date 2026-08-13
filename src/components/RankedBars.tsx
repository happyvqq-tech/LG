// 本期最常犯的錯誤類別排行
//
// 這一區的價值不在「你錯了幾次」，而在跟上期的比較。知道自己「介系詞錯 5 次」
// 沒什麼用；知道「介系詞從 9 次降到 5 次」才知道最近的努力有沒有打在點上，
// 也才知道下個月該繼續攻哪一塊。
//
// 用長條而不是圓餅：這裡要比的是量的大小，而長度是人最會比的視覺通道。
import type { ErrorTypeRank } from '../lib/progressRules'

const ACCENT = '#0d9488'

export default function RankedBars({ rows }: { rows: ErrorTypeRank[] }) {
  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
      <h2 className="font-bold text-slate-800">最常犯的錯</h2>
      <p className="mt-0.5 text-xs text-slate-500">近 30 天・括號內是上期次數</p>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          這 30 天沒有新錯誤入庫。可能是寫得少，也可能是真的變準了——多寫幾篇就知道。
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {rows.map((r) => {
            const max = Math.max(...rows.map((x) => x.count))
            const diff = r.count - r.prev
            return (
              <li key={`${r.language}-${r.type}`}>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-slate-700">
                    {r.type}
                    <span className="ml-1.5 text-xs text-slate-400">{r.language}</span>
                  </span>
                  <span className="tabular-nums text-slate-500">
                    <span className="font-semibold text-slate-800">{r.count}</span>
                    <span className="ml-1 text-xs">
                      ({r.prev}
                      {diff !== 0 && (
                        <span className={diff < 0 ? 'text-emerald-600' : 'text-orange-600'}>
                          {diff < 0 ? ' ↓' : ' ↑'}
                        </span>
                      )}
                      )
                    </span>
                  </span>
                </div>
                {/* 長條最粗 8px、資料端圓角、從同一條基線長出來 */}
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max((r.count / max) * 100, 6)}%`, backgroundColor: ACCENT }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
