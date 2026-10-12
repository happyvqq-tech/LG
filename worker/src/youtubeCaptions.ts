// YouTube 字幕的解析——純函式，可獨立測試
//
// 網路那一段在 index.ts 的 handleTranscript，這裡只處理「拿到東西之後怎麼讀」。
// 分開是因為網路那段在這個環境根本測不了（容器的代理擋掉 youtube.com），
// 而會長蟲的其實是解析：括號配對、滾動字幕的續寫標記、時間格式。

/** 失敗原因。前端照這個給不同的說明，不要全部變成一句「抓不到」 */
export type TranscriptMiss = 'blocked' | 'po_token' | 'no_captions' | 'empty' | 'unreachable'

export interface CaptionTrack {
  baseUrl?: string
  languageCode?: string
  kind?: string
}

/** 目標語言 → YouTube 的語言代碼前綴 */
export const LANG_CODE: Record<string, string> = { 英文: 'en', 日文: 'ja', 韓文: 'ko' }

/**
 * 從播放器回應裡挖出 captionTracks 陣列。
 *
 * 用括號配對而不是正規表示式：條目裡的 name 可能是 {runs:[…]}，
 * 有巢狀陣列，`\[.*?\]` 會在半路切斷。字串內的括號也要跳過。
 */
export function extractCaptionTracks(html: string): CaptionTrack[] {
  const key = '"captionTracks":'
  const at = html.indexOf(key)
  if (at < 0) return []

  const start = html.indexOf('[', at)
  if (start < 0) return []

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (c === '\\') escaped = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as CaptionTrack[]
        } catch {
          return []
        }
      }
    }
  }
  return []
}

/** 挑一條字幕軌：先找目標語言，再優先人工上傳的（自動辨識的錯字多） */
export function pickTrack(tracks: CaptionTrack[], wanted: string): CaptionTrack | null {
  const usable = tracks.filter((t) => typeof t.baseUrl === 'string' && t.baseUrl.length > 0)
  if (usable.length === 0) return null

  const sameLang = wanted ? usable.filter((t) => (t.languageCode ?? '').startsWith(wanted)) : []
  const pool = sameLang.length > 0 ? sameLang : usable
  return pool.find((t) => t.kind !== 'asr') ?? pool[0]
}

export interface Json3Event {
  tStartMs?: number
  segs?: Array<{ utf8?: string }>
  aAppend?: number
}

/** 秒數寫成 YouTube 轉錄稿面板的樣子（0:00 / 1:02:03），前端的解析器本來就吃這個格式 */
export function stamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const mm = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, '0')
  if (mm < 60) return `${mm}:${ss}`
  return `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, '0')}:${ss}`
}

/**
 * json3 → 跟 YouTube 轉錄稿面板同樣格式的純文字。
 *
 * 刻意輸出成「時間一行、內容一行」而不是自己發明一種 JSON：
 * 這樣使用者貼上的跟自動抓的走同一條解析路徑（lib/transcript.ts），
 * 不會有一條路有人走、另一條沒人走因而長蟲。
 */
export function json3ToPanelText(raw: string): string {
  let parsed: { events?: Json3Event[] }
  try {
    parsed = JSON.parse(raw) as { events?: Json3Event[] }
  } catch {
    return ''
  }

  const out: string[] = []
  let buf = ''
  let bufStart = 0

  function flush() {
    const text = buf.replace(/\s+/g, ' ').trim()
    if (text) out.push(`${stamp(bufStart / 1000)}\n${text}`)
    buf = ''
  }

  for (const ev of parsed.events ?? []) {
    // 自動辨識的字幕會把同一句滾動重送，aAppend 標記的那些是續寫、不是新句
    if (ev.aAppend === 1 || !Array.isArray(ev.segs)) continue
    const text = ev.segs.map((s) => s.utf8 ?? '').join('')
    if (!text.trim()) continue

    const start = typeof ev.tStartMs === 'number' ? ev.tStartMs : 0
    // 隔太久就先斷行再放進去。斷在「放進去之後」的話這一行會掛上
    // 六秒前的時間戳，按下去會從上一句開始播
    if (buf && start - bufStart >= 6000) flush()
    if (!buf) bufStart = start
    buf += (buf ? ' ' : '') + text
    // 併成跟面板差不多的長度：太碎的話每行只有兩三個字，看起來像壞掉
    if (buf.length >= 70) flush()
  }
  flush()

  return out.join('\n')
}

