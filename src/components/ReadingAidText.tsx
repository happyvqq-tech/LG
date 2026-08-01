// 讀音輔助的顯示：日文用 <ruby> 把假名標在漢字上方，韓文另起一行寫實際發音
//
// 兩個語言的呈現方式不能共用，因為它們是不同的東西：
//   日文的假名是「同一句話的讀法」，必須貼在對應的漢字正上方才有意義
//   韓文的實際發音是「同一句話的另一種寫法」，整句對照才看得出音變在哪
import { parseRuby } from '../lib/ruby'
import type { Language } from '../lib/types'

/** 日文：漢字上方標假名 */
export function RubySentence({ marked, className }: { marked: string; className?: string }) {
  const segments = parseRuby(marked)
  return (
    <p className={className}>
      {segments.map((s, i) =>
        s.ruby ? (
          // ruby-text-position 交給瀏覽器預設（上方）；rt 的字級縮到 0.55em
          // 是為了在手機上不把行高撐爆，同時還看得清楚
          <ruby key={i}>
            {s.text}
            <rt className="text-[0.55em] font-normal text-slate-500">{s.ruby}</rt>
          </ruby>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </p>
  )
}

/**
 * 依語言選擇呈現方式。
 * 日文回傳的是「取代原句」的版本；韓文回傳的是「加在原句下面」的一行。
 */
export default function ReadingAidText({
  language,
  aid,
  className,
}: {
  language: Language
  aid: string
  className?: string
}) {
  if (language === '日文') return <RubySentence marked={aid} className={className} />
  return (
    <p className={className}>
      <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
        實際發音
      </span>
      {aid}
    </p>
  )
}

/** 日文的輔助是「連同原句一起顯示」，韓文是「額外多一行」——版面要據此決定 */
export function replacesOriginal(language: Language): boolean {
  return language === '日文'
}
