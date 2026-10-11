// YouTube 逐字稿解析——純函式，可獨立測試
//
// 使用者從 YouTube 的「顯示轉錄稿」面板複製出來的格式長這樣：
//
//   0:00
//   hello and welcome back
//   0:03
//   today we're going to talk about
//
// 時間自成一行，內容在下一行。關掉時間戳的話就只有純文字。
// 兩種都要吃得下，因為使用者不會記得先去切那個開關。
//
// 拿到時間戳的好處跟歌曲一樣：可以只循環播這一段。真實影片其實更需要——
// 一段十分鐘的影片，沒有時間戳就只能從頭拖到尾找那八行在哪裡。

export interface TranscriptLine {
  /** 秒；沒有時間戳時為 null */
  time: number | null
  text: string
}

/** 單獨成行的時間戳：0:00 / 1:23 / 1:02:03 */
const TIME_ONLY = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})$/

/** 行首就帶時間戳的另一種貼法：「0:03 today we're going to」 */
const TIME_PREFIX = /^(?:(\d{1,2}):)?(\d{1,3}):(\d{2})\s+(.+)$/

function toSeconds(h: string | undefined, m: string, s: string): number {
  return (h ? Number(h) * 3600 : 0) + Number(m) * 60 + Number(s)
}

/**
 * 解析貼上的逐字稿。
 *
 * 刻意寬鬆：自動辨識的稿子本來就亂，使用者也可能漏複製或多貼了頁面雜訊。
 * 解析不出時間就讓 time 是 null——那只是少了分段播放，教材照常做得出來。
 */
export function parseTranscript(raw: string): TranscriptLine[] {
  const out: TranscriptLine[] = []
  let pending: number | null = null

  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue

    const only = TIME_ONLY.exec(t)
    if (only) {
      // 連續兩個時間戳之間沒有內容（空字幕），後面那個蓋掉前面的
      pending = toSeconds(only[1], only[2], only[3])
      continue
    }

    const prefixed = TIME_PREFIX.exec(t)
    if (prefixed) {
      out.push({ time: toSeconds(prefixed[1], prefixed[2], prefixed[3]), text: prefixed[4].trim() })
      pending = null
      continue
    }

    out.push({ time: pending, text: t })
    pending = null
  }

  return out
}

/** 把解析結果還原成純文字（送進 prompt 的是這個，時間戳只留在前端對位用） */
export function transcriptText(lines: TranscriptLine[]): string {
  return lines.map((l) => l.text).join('\n')
}

/** 比對用的正規化：大小寫、標點、空白都拿掉 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s.,!?;:'"’“”()[\]「」『』、。！？…\-—~〜]/g, '')
    .trim()
}

/**
 * 把教材的每一行對回逐字稿的時間。
 *
 * 跟歌詞那邊同樣由前往後掃：影片裡重複的句子（「so」「right」「you know」）
 * 很多，用全域表會全部對到第一次出現的位置，按下去就跳回影片開頭。
 */
export function matchTimes(lessonLines: string[], transcript: TranscriptLine[]): Array<number | null> {
  const keys = transcript.map((l) => ({ time: l.time, key: normalize(l.text) }))
  const out: Array<number | null> = []
  let cursor = 0

  for (const line of lessonLines) {
    const key = normalize(line)
    if (!key) {
      out.push(null)
      continue
    }
    // 先找完全相同，再退一步找「包含」——自動辨識的稿子常被切在奇怪的位置，
    // 教材那行可能是逐字稿兩行黏起來的
    let found = keys.findIndex((l, i) => i >= cursor && l.key === key)
    if (found < 0) found = keys.findIndex((l, i) => i >= cursor && l.key.length > 0 && key.includes(l.key))
    if (found >= 0) {
      out.push(keys[found].time)
      cursor = found + 1
    } else {
      out.push(null)
    }
  }

  return out
}

/** 這一段在影片裡的起訖秒數。對不到任何一行就回 null（退回整支播放） */
export function clipRange(
  times: Array<number | null>,
  transcript: TranscriptLine[],
): { start: number; end: number } | null {
  const known = times.filter((t): t is number => t !== null)
  if (known.length === 0) return null

  const start = Math.min(...known)
  const lastLine = Math.max(...known)
  const after = transcript.find((l) => l.time !== null && l.time > lastLine)
  // 沒有下一行（整段在影片結尾）就給 10 秒餘裕
  const end = after?.time ?? lastLine + 10

  return { start: Math.max(0, start - 0.5), end }
}
