// 難度調整建議卡（首頁）
//
// 只建議、不自動改。使用者按下去才會動到 profiles.level，
// 按「先維持」則兩週內不再問同一件事。
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadEvidence } from '../lib/levelAdviceService'
import {
  buildLevelAdvice,
  dismissAdvice,
  shouldShowAdvice,
  type LevelAdvice as Advice,
} from '../lib/levelAdviceRules'
import { LEVEL_INFO, type Language, type Profile } from '../lib/types'

export default function LevelAdvice({
  profile,
  language,
  onChanged,
}: {
  profile: Profile
  language: Language
  /** 程度改完後讓外層重新讀 profile */
  onChanged: () => void
}) {
  const [advice, setAdvice] = useState<Advice | null>(null)
  const [saving, setSaving] = useState(false)
  const [now] = useState(() => new Date())

  useEffect(() => {
    let alive = true
    loadEvidence(profile.id, language, now)
      .then((ev) => {
        if (!alive) return
        const a = buildLevelAdvice(profile.level, ev)
        setAdvice(shouldShowAdvice(a, now) ? a : null)
      })
      // 讀不到就不顯示。這是加分功能，不該在首頁跳錯誤訊息
      .catch(() => alive && setAdvice(null))
    return () => {
      alive = false
    }
  }, [profile.id, profile.level, language, now])

  if (!advice || advice.to === null) return null

  const up = advice.kind === 'up'

  async function apply() {
    if (!advice?.to || saving) return
    setSaving(true)
    const { error } = await supabase.from('profiles').update({ level: advice.to }).eq('id', profile.id)
    setSaving(false)
    if (error) return // 失敗就讓卡片留著，下次再試
    setAdvice(null)
    onChanged()
  }

  function later() {
    if (!advice) return
    dismissAdvice(advice, now)
    setAdvice(null)
  }

  return (
    <section
      className={`mt-4 rounded-2xl p-4 ring-1 ${
        up ? 'bg-teal-50 ring-teal-200/70' : 'bg-sky-50 ring-sky-200/70'
      }`}
    >
      <p className={`text-sm font-bold ${up ? 'text-teal-900' : 'text-sky-900'}`}>
        {up ? '⬆️ 這個程度好像太輕鬆了' : '🫱 要不要先降一級？'}
      </p>
      {/* 一定要講出憑據。沒有數字的「系統建議您升級」不會有人聽 */}
      <p className={`mt-1 text-sm leading-relaxed ${up ? 'text-teal-800/80' : 'text-sky-800/80'}`}>
        {advice.reason}。建議把程度從 {advice.from} 調成 {advice.to}
        （{LEVEL_INFO[advice.to]?.label ?? ''}）。
        {up ? '往上一級會讓句子變長、用字更精確。' : '降一級不是退步，是把地基補穩再往上。'}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void apply()}
          disabled={saving}
          className={`flex-1 rounded-xl py-3 font-bold text-white disabled:opacity-60 ${
            up ? 'bg-teal-600' : 'bg-sky-600'
          }`}
        >
          {saving ? '調整中…' : `調成 ${advice.to}`}
        </button>
        <button
          onClick={later}
          className="rounded-xl bg-white/70 px-4 py-3 text-sm font-semibold text-slate-500"
        >
          先維持
        </button>
      </div>
    </section>
  )
}
