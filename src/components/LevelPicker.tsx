// 程度選擇：滑鼠移上（或手機點選）顯示該程度的白話說明
import { useState } from 'react'
import { ALL_LEVELS, LEVEL_INFO, type Level } from '../lib/types'

export default function LevelPicker({
  value,
  onChange,
}: {
  value: Level
  onChange: (level: Level) => void
}) {
  const [hovered, setHovered] = useState<Level | null>(null)
  // 沒有滑鼠時（手機）就顯示目前選取的程度說明
  const shown = hovered ?? value

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {ALL_LEVELS.map((lv) => (
          <button
            key={lv}
            onClick={() => onChange(lv)}
            onMouseEnter={() => setHovered(lv)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(lv)}
            onBlur={() => setHovered(null)}
            className={`flex flex-col items-center rounded-2xl px-4 py-2 leading-tight transition ${
              value === lv
                ? 'bg-teal-600 text-white shadow-md shadow-teal-600/25'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            <span className="text-base font-bold">{lv}</span>
            <span className="text-xs opacity-80">{LEVEL_INFO[lv].label}</span>
          </button>
        ))}
      </div>

      <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm leading-relaxed text-slate-600 ring-1 ring-slate-200/70">
        <span className="font-bold text-teal-700">
          {shown}・{LEVEL_INFO[shown].label}
        </span>
        <br />
        {LEVEL_INFO[shown].desc}
      </p>
    </div>
  )
}
