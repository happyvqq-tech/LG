// 每日學習計畫 → .ics 行事曆檔（可加入 Google Calendar / Apple 行事曆）
// 使用 floating time（不帶時區）：手機在哪個時區就在當地那個時間提醒

import type { DailyPlan, Profile } from './types'

/** 0=週日 … 6=週六 → iCalendar BYDAY 代碼 */
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** RFC 5545 要求單行 ≤75 octets，超過需以「CRLF + 空白」折行 */
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 74) return line

  const out: string[] = []
  let chunk = ''
  let chunkBytes = 0
  for (const ch of line) {
    const size = new TextEncoder().encode(ch).length
    // 續行前綴會佔 1 octet，故續行的可用長度少 1
    const limit = out.length === 0 ? 74 : 73
    if (chunkBytes + size > limit) {
      out.push(chunk)
      chunk = ''
      chunkBytes = 0
    }
    chunk += ch
    chunkBytes += size
  }
  if (chunk) out.push(chunk)
  return out.join('\r\n ')
}

/** 逗號、分號、反斜線、換行在 TEXT 值中須跳脫 */
function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/** 找出從今天起、第一個符合 plan.days 的日期作為系列起點 */
function firstOccurrence(plan: DailyPlan, from: Date): Date {
  const [hh, mm] = plan.time.split(':').map(Number)
  const d = new Date(from)
  d.setHours(hh, mm, 0, 0)
  if (d <= from) d.setDate(d.getDate() + 1)
  for (let i = 0; i < 7; i++) {
    if (plan.days.includes(d.getDay())) return d
    d.setDate(d.getDate() + 1)
  }
  return d
}

function localStamp(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`
}

function utcStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

/** 產生每週重複的學習提醒 .ics 內容 */
export function buildStudyPlanIcs(profile: Profile, plan: DailyPlan, now = new Date()): string {
  const start = firstOccurrence(plan, now)
  const end = new Date(start.getTime() + plan.minutes * 60_000)
  const byday = plan.days
    .slice()
    .sort((a, b) => a - b)
    .map((d) => BYDAY[d])
    .join(',')

  const langs = profile.languages.join('、')
  const uid = `lglearning-${profile.id}@happyvqq-tech.github.io`

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//lglearning//family language learning//TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${localStamp(start)}`,
    `DTEND:${localStamp(end)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${byday}`,
    foldLine(`SUMMARY:${escapeText(`${profile.name} 的語言學習（${langs}）`)}`),
    foldLine(
      `DESCRIPTION:${escapeText(
        `今天練 ${plan.minutes} 分鐘：聽 → 讀 → 說 → 寫\n開啟 https://happyvqq-tech.github.io/lglearning/`,
      )}`,
    ),
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    foldLine(`DESCRIPTION:${escapeText(`10 分鐘後該練 ${langs} 了`)}`),
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  return lines.join('\r\n') + '\r\n'
}

/** 觸發瀏覽器下載 .ics（手機點開後可直接加入行事曆） */
export function downloadIcs(profile: Profile, plan: DailyPlan): void {
  const blob = new Blob([buildStudyPlanIcs(profile, plan)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  // 檔名故意不放中文（連成員名字都不放）：實測這個環境的瀏覽器只要
  // download 屬性帶非 ASCII 字元就會整個退化成沒有副檔名的「download」，
  // 手機下載清單裡因此可能不會跳出「加入行事曆」的選項。中文情境還是
  // 完整保留在行事曆事件本身的標題／說明裡，只有檔名改成純 ASCII。
  a.download = 'lgl-study-plan.ics'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
