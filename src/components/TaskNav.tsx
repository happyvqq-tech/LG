// 學習頁共用導覽列：回首頁 + 聽/讀/說/寫 進度條
import { useNavigate } from 'react-router-dom'
import { stopSpeaking } from '../lib/speech'

export type SkillStep = 'listening' | 'reading' | 'speaking' | 'writing'

const STEPS: Array<{ key: SkillStep; label: string; icon: string; path: string }> = [
  { key: 'listening', label: '聽', icon: '🎧', path: '/listening' },
  { key: 'reading', label: '讀', icon: '📖', path: '/reading' },
  { key: 'speaking', label: '說', icon: '🗣️', path: '/speaking' },
  { key: 'writing', label: '寫', icon: '✍️', path: '/writing' },
]

export default function TaskNav({
  current,
  locked = [],
}: {
  current: SkillStep
  /** 尚未達成前置關卡的步驟：顯示鎖頭、點了沒反應（見稽核報告 P0-2） */
  locked?: SkillStep[]
}) {
  const navigate = useNavigate()
  const currentIndex = STEPS.findIndex((s) => s.key === current)

  function go(path: string, isLocked: boolean) {
    if (isLocked) return
    stopSpeaking()
    navigate(path)
  }

  return (
    <nav className="mb-4 rounded-2xl bg-white/70 p-3 shadow-sm ring-1 ring-slate-200/60 backdrop-blur">
      <button
        onClick={() => go('/home', false)}
        className="flex items-center gap-1 rounded-full px-1 text-sm font-semibold text-slate-500 active:bg-slate-100"
      >
        ← 回首頁
      </button>

      <ol className="flex items-start">
        {STEPS.map((s, i) => {
          const done = i < currentIndex
          const active = i === currentIndex
          const isLocked = locked.includes(s.key)
          return (
            <li key={s.key} className="flex flex-1 items-start last:flex-none">
              <button
                onClick={() => go(s.path, isLocked)}
                aria-current={active ? 'step' : undefined}
                aria-disabled={isLocked || undefined}
                aria-label={isLocked ? `${s.label}力練習尚未解鎖` : `前往${s.label}力練習`}
                className={`flex flex-col items-center gap-1 px-1 ${isLocked ? 'cursor-not-allowed' : ''}`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm transition ${
                    isLocked
                      ? 'bg-slate-100 text-slate-300'
                      : active
                        ? 'bg-teal-600 text-white shadow-md shadow-teal-600/30'
                        : done
                          ? 'bg-teal-100 text-teal-700'
                          : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {isLocked ? '🔒' : done ? '✓' : s.icon}
                </span>
                <span
                  className={`text-xs font-semibold ${
                    isLocked ? 'text-slate-300' : active ? 'text-teal-700' : done ? 'text-teal-600' : 'text-slate-400'
                  }`}
                >
                  {s.label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <span
                  className={`mt-[18px] h-0.5 flex-1 rounded-full ${done ? 'bg-teal-300' : 'bg-slate-200'}`}
                />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
