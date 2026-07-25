// 朗讀速度選擇器：慢／正常／快／很快／極快
import { SPEED_HINT, SPEED_LEVELS, type SpeedLevel } from '../lib/speechRate'

export default function SpeedPicker({
  level,
  onChange,
  showHint = true,
  compact = false,
}: {
  level: SpeedLevel
  onChange: (level: SpeedLevel) => void
  showHint?: boolean
  /** 空間吃緊處（例如對話頁頂端）用小尺寸 */
  compact?: boolean
}) {
  return (
    <div>
      <div className={`flex gap-1.5 ${compact ? '' : 'flex-wrap'}`}>
        {SPEED_LEVELS.map((lv) => (
          <button
            key={lv}
            onClick={() => onChange(lv)}
            aria-pressed={level === lv}
            className={`min-h-0 rounded-full font-semibold transition ${
              compact ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-2 text-sm'
            } ${
              level === lv
                ? 'bg-teal-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 active:bg-slate-200'
            }`}
          >
            {lv}
          </button>
        ))}
      </div>
      {showHint && <p className="mt-1.5 text-xs text-slate-400">{SPEED_HINT[level]}</p>}
    </div>
  )
}
