// 任務完成的結算畫面（全螢幕，蓋在總結頁上面）
//
// 刻意做得克制：使用者是成人，滿天飛的彩帶與音效只會讓人想快點關掉。
// 這裡的做法是一個安靜的漸層底、內容依序淡入，把「最值得高興的那件事」
// 放到最大——情緒的來源是內容本身，不是特效。
//
// 動畫全部走 CSS transition，沒有引入任何動畫套件；
// 系統開了「減少動態效果」時自動關掉位移與縮放。
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { buildCelebration, summaryParts, type CelebrationData } from '../lib/celebrationRules'

/** 依序淡入：每一塊比前一塊晚 90ms，讀的人視線會被帶著走 */
function Reveal({ delay, children }: { delay: number; children: React.ReactNode }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), delay)
    return () => clearTimeout(t)
  }, [delay])
  return (
    <div
      className={`transition-all duration-500 ease-out motion-reduce:transition-none ${
        shown ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0 motion-reduce:opacity-100'
      }`}
    >
      {children}
    </div>
  )
}

export default function TaskCelebration({ data }: { data: CelebrationData }) {
  const navigate = useNavigate()
  const view = buildCelebration(data)
  const parts = summaryParts(data)

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gradient-to-b from-teal-700 via-teal-600 to-teal-700 text-white">
      <div className="mx-auto flex min-h-full max-w-md flex-col justify-center p-7">
        <Reveal delay={60}>
          <p className="text-center text-6xl leading-none">{view.emoji}</p>
        </Reveal>

        <Reveal delay={150}>
          <h1 className="mt-5 text-center text-3xl font-bold leading-tight">{view.headline}</h1>
          <p className="mt-3 text-center text-sm leading-relaxed text-teal-50/85">{view.sub}</p>
        </Reveal>

        {/* 攻克的錯誤逐條列出來。只講「攻克了 2 個」很抽象，
            把「以前這樣寫 → 現在這樣寫」擺出來才看得到自己變在哪裡 */}
        {data.resolvedErrors.length > 0 && (
          <Reveal delay={260}>
            <ul className="mt-6 space-y-2">
              {data.resolvedErrors.map((e) => (
                <li key={e.id} className="rounded-2xl bg-white/10 p-3.5">
                  <p className="text-xs font-semibold text-teal-100/80">{e.error_type}</p>
                  <p className="mt-1 text-sm leading-relaxed">
                    <span className="text-teal-100/70 line-through">{e.original}</span>
                    <span className="mx-1.5 text-teal-100/60">→</span>
                    <span className="font-semibold">{e.corrected}</span>
                  </p>
                </li>
              ))}
            </ul>
          </Reveal>
        )}

        {/* 連續天數。主標已經在講連續天數（streak／milestone）時不重複顯示；
            剛好踩到里程碑時也讓給下面那個徽章，不然會出現兩個都寫「連續 7 天」 */}
        {data.streakAfter > 0 && view.streakMilestone === null && view.tone !== 'streak' && view.tone !== 'milestone' && (
          <Reveal delay={340}>
            <p className="mt-6 text-center">
              <span className="inline-block rounded-full bg-white/15 px-4 py-2 text-sm font-bold">
                🔥 連續 {data.streakAfter} 天{view.streakGained && ' ・ +1'}
              </span>
            </p>
          </Reveal>
        )}

        {view.streakMilestone !== null && view.tone === 'resolved' && (
          <Reveal delay={340}>
            <p className="mt-6 text-center">
              <span className="inline-block rounded-full bg-white/15 px-4 py-2 text-sm font-bold">
                🏅 連續 {view.streakMilestone} 天達成
              </span>
            </p>
          </Reveal>
        )}

        {parts.length > 0 && (
          <Reveal delay={420}>
            <p className="mt-6 text-center text-sm text-teal-50/75">今天　{parts.join('・')}</p>
          </Reveal>
        )}

        <Reveal delay={520}>
          <div className="mt-8 grid gap-2.5">
            <button
              onClick={() => navigate('/home')}
              className="w-full rounded-xl bg-white py-3.5 text-lg font-bold text-teal-700 active:scale-[0.98]"
            >
              回首頁
            </button>
            {/* 導到存摺：剛完成任務、心情正好的時候，是最適合看到
                「累積了這麼多」的時機 */}
            <button
              onClick={() => navigate('/progress')}
              className="w-full rounded-xl bg-white/10 py-3 font-semibold text-white active:scale-[0.98]"
            >
              看看累積了多少 📈
            </button>
          </div>
        </Reveal>
      </div>
    </div>
  )
}
