// 全家本週狀態看板（放在選成員的首頁）
//
// 刻意不做成排行榜：只標示每個人自己的連續天數與本週足跡，不給名次數字、
// 不做「誰最混」的反向排名。家人不是排行榜上的陌生人——讓落後的人自己看到
// 格子是空的就夠了，系統不需要再補一刀。
//
// 摘要那幾行由規則產生，不呼叫 AI（見 familyRules.ts）。
import Avatar from './Avatar'
import { buildDigest, sortMembers, weekSeed, type MemberWeek } from '../lib/familyRules'
import type { Profile } from '../lib/types'

const WEEKDAY = ['日', '一', '二', '三', '四', '五', '六']

/** 最近 7 天的格子。索引 0=6 天前…6=今天，跟 streakRules 的 last7 對齊 */
function Last7({ days, now }: { days: boolean[]; now: Date }) {
  return (
    <div className="flex gap-1">
      {days.map((on, i) => {
        const d = new Date(now)
        d.setDate(d.getDate() - (6 - i))
        return (
          <span
            key={i}
            title={`${WEEKDAY[d.getDay()]} ${on ? '有練習' : '沒練習'}`}
            className={`h-4 w-4 rounded-[3px] ${on ? 'bg-teal-500' : 'bg-slate-200'} ${
              i === 6 ? 'ring-1 ring-teal-700' : ''
            }`}
          />
        )
      })}
    </div>
  )
}

export default function FamilyBoard({
  members,
  profiles,
  now,
}: {
  members: MemberWeek[]
  profiles: Profile[]
  now: Date
}) {
  if (members.length < 2) return null // 只有一個成員時，「全家」沒有意義

  const byId = new Map(profiles.map((p) => [p.id, p]))
  const digest = buildDigest(members, weekSeed(now))

  return (
    <section className="mt-6 rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <div className="flex items-baseline justify-between">
        <h2 className="font-bold text-slate-800">全家這一週</h2>
        <span className="text-xs text-slate-400">最近 7 天</span>
      </div>

      <ul className="mt-3 space-y-2.5">
        {sortMembers(members).map((m) => {
          const p = byId.get(m.profileId)
          return (
            <li key={m.profileId} className="flex items-center gap-3">
              {p && <Avatar profile={p} size="sm" />}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700">{m.name}</span>
              <Last7 days={m.last7} now={now} />
              <span
                className={`w-14 shrink-0 text-right text-xs font-bold ${
                  m.streak > 0 ? 'text-teal-700' : 'text-slate-300'
                }`}
              >
                {m.streak > 0 ? `🔥 ${m.streak} 天` : '—'}
              </span>
            </li>
          )
        })}
      </ul>

      {digest.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
          {digest.map((line) => (
            <p key={line.text} className="text-sm leading-relaxed text-slate-600">
              <span className="mr-1.5">{line.emoji}</span>
              {line.text}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
