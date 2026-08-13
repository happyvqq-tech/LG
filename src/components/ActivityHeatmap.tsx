// 練習足跡熱力圖（近 12 週）
//
// 為什麼值得放這一區：連續天數只講「現在連幾天」，斷掉就歸零，看不出全貌。
// 熱力圖把三個月攤在一個畫面上，斷過的那幾天仍然看得到前後大片的綠色——
// 「我其實一直有在做，只是上週忙」跟「我是不是又放棄了」是完全不同的心情。
//
// 色階用同一個色相由淺到深（sequential），深淺對應當天碰了幾種模組。
// 沒練習的日子用中性灰而不是最淺的綠：那是「沒有」，不是「很少」。
import { shortDate, type HeatCell } from '../lib/progressRules'
import { toDateString } from '../lib/srs'

/** 相鄰層的辨識度經 dataviz validator 檢查（最差相鄰 ΔE 21.2，正常視覺與色覺缺陷皆可分辨） */
const LEVEL_FILL = ['#f1f5f9', '#a7f3e5', '#14b8a6', '#115e59'] as const
const LEVEL_TEXT = ['沒有練習', '有練習', '練了兩種', '練了三種以上'] as const

const ROW_LABEL: Record<number, string> = { 1: '一', 3: '三', 5: '五' }

export default function ActivityHeatmap({ grid }: { grid: HeatCell[][] }) {
  if (grid.length === 0) return null

  const today = toDateString(new Date())
  const days = grid.flat().filter((c) => c.level > 0).length

  return (
    <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
      <h2 className="font-bold text-slate-800">練習足跡</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        近 12 週・共 {days} 天有練習
      </p>

      {/*
        星期標籤跟格子放在「同一個 grid」裡，當成第一欄。
        分成兩個並排的 grid 時，標籤那欄沒有 aspect-square 撐高度，列高會跟
        格子對不齊——一開始就是這樣，「三」會飄到第三、四列中間。
        同一個 grid 就不可能對不齊，因為列高本來就是同一份定義。
      */}
      <div
        className="mt-3 grid gap-[2px]"
        style={{ gridAutoFlow: 'column', gridTemplateRows: 'repeat(7, 1fr)', gridAutoColumns: '1fr' }}
      >
        {Array.from({ length: 7 }, (_, r) => (
          <span key={`label-${r}`} className="flex items-center text-[9px] leading-none text-slate-400">
            {ROW_LABEL[r] ?? ''}
          </span>
        ))}
        {grid.map((week) =>
          week.map((cell) => (
            <div
              key={cell.date}
              title={`${shortDate(cell.date)}　${LEVEL_TEXT[cell.level]}`}
              aria-label={`${shortDate(cell.date)} ${LEVEL_TEXT[cell.level]}`}
              className={`aspect-square rounded-[3px] ${cell.date === today ? 'ring-1 ring-teal-700' : ''}`}
              style={{ backgroundColor: LEVEL_FILL[cell.level] }}
            />
          )),
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-end gap-1.5 text-[10px] text-slate-400">
        <span>少</span>
        {LEVEL_FILL.map((fill, i) => (
          <span
            key={fill}
            aria-label={LEVEL_TEXT[i]}
            className="h-2.5 w-2.5 rounded-[3px]"
            style={{ backgroundColor: fill }}
          />
        ))}
        <span>多</span>
      </div>
    </section>
  )
}
