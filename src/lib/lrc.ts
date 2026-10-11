// 同步歌詞（LRC）解析與對位——純函式，可獨立測試
//
// 為什麼時間戳比歌詞本身值錢：有了它才能「只循環播這一段」。
// 學一首歌真正有效的練法不是從頭聽到尾，是把 12 秒的一句反覆聽到嘴巴跟得上，
// 而那件事沒有時間戳就做不到。
//
// LRCLIB 回傳的是標準 LRC：每行開頭一或多個 [mm:ss.xx] 標記。

export interface LrcLine {
  /** 秒 */
  time: number
  text: string
}

/** [ar:…] [ti:…] [by:…] 這類是檔案的 metadata，不是歌詞 */
const META_TAG = /^\[[a-z]{2,10}:/i
const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

/**
 * 解析 LRC 文字。
 * 一行可以掛多個時間標記（副歌重複時常見），會各自展開成一筆。
 */
export function parseLrc(raw: string): LrcLine[] {
  const out: LrcLine[] = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    TIME_TAG.lastIndex = 0
    const stamps: number[] = []
    let m: RegExpExecArray | null
    while ((m = TIME_TAG.exec(trimmed)) !== null) {
      const min = Number(m[1])
      const sec = Number(m[2])
      // 小數位數不固定（.5 / .50 / .500），補到三位再當毫秒算
      const frac = m[3] ? Number(m[3].padEnd(3, '0')) : 0
      stamps.push(min * 60 + sec + frac / 1000)
    }
    if (stamps.length === 0) continue

    const text = trimmed.replace(TIME_TAG, '').trim()
    // 純 metadata 行（[ar:…]）會被上面的時間標記正規表示式忽略而留下原文，擋掉
    if (META_TAG.test(text)) continue
    // 空白行在 LRC 裡代表間奏，保留時間但沒有文字可對，直接略過
    if (!text) continue

    for (const t of stamps) out.push({ time: t, text })
  }

  return out.sort((a, b) => a.time - b.time)
}

/**
 * 比對用的正規化：大小寫、標點、空白都拿掉。
 *
 * 必須夠寬鬆——教材那邊的歌詞是使用者看到的版本，LRC 那邊是社群打的，
 * 兩邊的標點與大小寫幾乎不會完全一樣。但也不能寬鬆到把不同句子對在一起，
 * 所以保留所有文字字元本身。
 */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s.,!?;:'"’“”()[\]「」『』、。！？…\-—~〜]/g, '')
    .trim()
}

/**
 * 把教材的每一行對到 LRC 的時間。
 *
 * 刻意由前往後掃而不是建一張全域表：副歌的同一句會出現很多次，
 * 用全域表會全部對到第一次出現的時間，於是第三段副歌按下去會跳回歌曲開頭。
 * 依序往前推進才能讓第 n 次出現對到第 n 個時間點。
 */
export function matchLineTimes(lines: string[], lrc: LrcLine[]): Array<number | null> {
  const normalizedLrc = lrc.map((l) => ({ time: l.time, key: normalizeForMatch(l.text) }))
  const out: Array<number | null> = []
  let cursor = 0

  for (const line of lines) {
    const key = normalizeForMatch(line)
    if (!key) {
      out.push(null)
      continue
    }
    const found = normalizedLrc.findIndex((l, i) => i >= cursor && l.key === key)
    if (found >= 0) {
      out.push(normalizedLrc[found].time)
      cursor = found + 1
    } else {
      out.push(null)
    }
  }

  return out
}

/** 一段的起訖時間。對不到任何一句就回 null（畫面會退回整首播放） */
export function segmentRange(
  times: Array<number | null>,
  lrc: LrcLine[],
): { start: number; end: number } | null {
  const known = times.filter((t): t is number => t !== null)
  if (known.length === 0) return null

  const start = Math.min(...known)
  const lastLine = Math.max(...known)
  // 結尾取「最後一句之後的下一個時間點」，否則最後一句會被切掉
  const next = lrc.find((l) => l.time > lastLine)
  // 真的沒有下一句（整首的最後一行）就給 8 秒的餘裕
  const end = next ? next.time : lastLine + 8

  return { start: Math.max(0, start - 0.3), end }
}
