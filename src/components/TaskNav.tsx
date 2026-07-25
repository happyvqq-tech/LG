// 學習頁共用導覽列：回首頁 + 聽/讀/說/寫 進度條
//
// 四關可以直接互跳（TaskHome 首頁本身也是聽力/閱讀/口說/寫作四個按鈕
// 平行並列），這裡刻意不做「前一關沒完成就鎖住下一關」的強制——聽力頁
// 內建的「聽兩次解鎖」只是那一頁自己的節奏提示，不代表其他關卡也要
// 被擋，之前加過鎖頭邏輯造成使用者無法直接選要練的關卡，已經拿掉。
import { useNavigate } from 'react-router-dom'
import { stopSpeaking } from '../lib/speech'

export type SkillStep = 'listening' | 'reading' | 'speaking' | 'writing'

const STEPS: Array<{ key: SkillStep; label: string; icon: string; path: string }> = [
  { key: 'listening', label: '聽', icon: '🎧', path: '/listening' },
  { key: 'reading', label: '讀', icon: '📖', path: '/reading' },
  { key: 'speaking', label: '說', icon: '🗣️', path: '/speaking' },
  { key: 'writing', label: '寫', icon: '✍️', path: '/writing' },
]

export default function TaskNav({ current }: { current: SkillStep }) {
  const navigate = useNavigate()
  const currentIndex = STEPS.findIndex((s) => s.key === current)

  function go(path: string) {
    stopSpeaking()
    navigate(path)
  }

  return (
    <nav className="mb-4 rounded-2xl bg-white/70 p-3 shadow-sm ring-1 ring-slate-200/60 backdrop-blur">
      <button
        onClick={() => go('/home')}
        className="flex items-center gap-1 rounded-full px-1 text-sm font-semibold text-slate-500 active:bg-slate-100"
      >
        ← 回首頁
      </button>

      <ol className="flex items-start">
        {STEPS.map((s, i) => {
          const done = i < currentIndex
          const active = i === currentIndex
          return (
            <li key={s.key} className="flex flex-1 items-start last:flex-none">
              <button
                onClick={() => go(s.path)}
                aria-current={active ? 'step' : undefined}
                aria-label={`前往${s.label}力練習`}
                className="flex flex-col items-center gap-1 px-1"
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm transition ${
                    active
                      ? 'bg-teal-600 text-white shadow-md shadow-teal-600/30'
                      : done
                        ? 'bg-teal-100 text-teal-700'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {done ? '✓' : s.icon}
                </span>
                <span
                  className={`text-xs font-semibold ${
                    active ? 'text-teal-700' : done ? 'text-teal-600' : 'text-slate-400'
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
