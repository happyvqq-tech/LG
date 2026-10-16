// 影片逐字稿的第二層：讓 Google Gemini 直接「聽」那支 YouTube 影片
//
// ── 為什麼這條路走得通，而硬抓字幕走不通 ───────────────────
//
// 第一層（handleTranscript 的試抓）是去 youtube.com 把字幕檔挖出來，
// 卡在 PO token 與機房 IP 封鎖，命中率很低——那是 YouTube 刻意鎖的。
// 這一層不碰字幕檔：把影片網址交給 Gemini API，由 **Google 自己的服務去讀 YouTube**，
// 聽完音訊直接寫出逐字稿。這是官方支援的用法（公開影片、免費額度每天 8 小時），
// 不是灰色地帶的爬蟲，所以不會被擋。
//
// ── 這跟「逐字稿絕不讓模型生成」不衝突 ─────────────────────
//
// 那條規則擋的是模型**憑記憶**寫出來的東西（會錯字漏行、甚至整段杜撰）。
// 這裡是**聽實際音訊**轉寫，性質跟 YouTube 自己的自動字幕一樣：會聽錯字，
// 但不會憑空捏造。所以保留同樣的防線——抓回來先給使用者看過才做教材，
// 而且畫面明講這是 AI 聽寫的。
//
// ── 最怕的不是聽錯，是「幫你修乾淨」──────────────────────
//
// 語言模型轉寫時很愛順手刪掉 um／you know／えーと，把重複與講錯的地方修順。
// 但影片教材教的正是這些（填充詞、真實口語的樣子），修乾淨等於把教材的重點刪掉。
// 所以 prompt 第一條就是逐字、保留填充詞與口誤。

export interface GeminiOk {
  ok: true
  /** 跟 YouTube 轉錄稿面板同格式（時間一行、內容一行），前端解析器直接吃 */
  text: string
  model: string
}

export interface GeminiFail {
  ok: false
  reason: 'no_speech' | 'unusable' | 'quota' | 'key_rejected' | 'failed'
  detail: string
}

export type GeminiResult = GeminiOk | GeminiFail

/**
 * 依序嘗試的模型。第一個 404（模型不存在或已下架）就換下一個——
 * Gemini 的模型名稱變動很快，寫死一個會在某天無聲無息地壞掉。
 * 可以用 Worker 環境變數 GEMINI_MODEL 指定，指定的會排在最前面。
 */
export const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-3-flash-preview']

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * 只聽前六分鐘。教材只取其中 8-15 行精聽，逐字稿也只會用前 2000 字左右，
 * 聽完一支三十分鐘的影片只是多花錢、多等一分鐘，手機還可能等到斷線。
 */
export const CLIP_SECONDS = 360

const LANG_NAME: Record<string, string> = { 英文: 'English', 日文: 'Japanese', 韓文: 'Korean' }

export function transcribePrompt(language: string): string {
  const lang = LANG_NAME[language] ?? 'the original spoken language'
  return `Transcribe the speech in this video verbatim, in ${lang} exactly as it is spoken.

Rules:
- Write exactly what is said, including fillers (um, uh, you know, like, えーと, あの, なんか, 그, 뭐, 그니까), repetitions, false starts and unfinished sentences. Do not clean anything up, correct grammar, summarize, translate, or skip parts. These spoken features are what the transcript will be used to teach.
- Do not describe visuals, music, sound effects or on-screen text.
- If there is no speech at all, output only: NO_SPEECH
- Output format: a timestamp on its own line, then the words spoken from that moment on the next line, repeated. For example:
0:00
so um today we're gonna talk about
0:06
the thing that everyone gets wrong
- Timestamps are M:SS (H:MM:SS past one hour) and mark when that segment starts in the video. Make each segment about 5-10 seconds, breaking at natural pauses.
- Output only the transcript. No title, no notes, nothing before or after it.`
}

/**
 * 請求本體。optimized 版多帶三個省錢的設定：只聽前六分鐘、低畫質取樣
 * （我們要的是聲音，畫面能省則省）、關掉思考。
 *
 * 這三個欄位在不同代的模型上名稱或支援度不一，送錯會 400——
 * 所以 400 時退回只帶必要欄位的版本再試一次（見 transcribeWithGemini）。
 */
export function buildBody(videoId: string, language: string, optimized: boolean): Record<string, unknown> {
  const video: Record<string, unknown> = {
    file_data: { file_uri: `https://www.youtube.com/watch?v=${videoId}` },
  }
  if (optimized) video.video_metadata = { start_offset: '0s', end_offset: `${CLIP_SECONDS}s` }

  const body: Record<string, unknown> = {
    contents: [{ parts: [video, { text: transcribePrompt(language) }] }],
  }
  if (optimized) {
    body.generation_config = {
      media_resolution: 'MEDIA_RESOLUTION_LOW',
      thinking_config: { thinking_budget: 0 },
    }
  }
  return body
}

/** 從 generateContent 的回應裡取出文字（可能分成好幾個 part） */
export function extractText(json: unknown): string {
  const candidates = (json as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates
  const parts = candidates?.[0]?.content?.parts ?? []
  return parts.map((p) => p.text ?? '').join('')
}

/**
 * 把模型輸出整理成面板格式，並判斷能不能用。
 *
 * 模型偶爾不照格式：[0:05]、(00:05)、0:05 - 文字、0:05: 文字……都轉成
 * 「時間一行、內容一行」。時間戳少於三個多半是它改寫成摘要了，那種不能用——
 * 摘要拿去做「逐句精聽」教材，教的就不是影片裡真的講過的話。
 */
export function normalizeTranscript(raw: string): { ok: true; text: string } | { ok: false; reason: 'no_speech' | 'unusable' } {
  const cleaned = raw.replace(/^\s*```[a-z]*\s*/i, '').replace(/\s*```\s*$/, '').trim()
  if (/^NO_SPEECH\b/.test(cleaned)) return { ok: false, reason: 'no_speech' }

  const TIME = String.raw`(?:\d{1,2}:)?\d{1,3}:\d{2}`
  const out: string[] = []
  let stamps = 0

  for (const line of cleaned.split('\n')) {
    const t = line.trim()
    if (!t) continue

    // 單獨一行的時間戳（允許外面包著括號）
    const only = new RegExp(`^[\\[(]?(${TIME})[\\])]?$`).exec(t)
    if (only) {
      out.push(only[1].replace(/^0(\d:)/, '$1'))
      stamps++
      continue
    }
    // 時間戳後面直接接文字：拆成兩行
    const prefixed = new RegExp(`^[\\[(]?(${TIME})[\\])]?\\s*[-–—:：]?\\s+(.+)$`).exec(t)
    if (prefixed) {
      out.push(prefixed[1].replace(/^0(\d:)/, '$1'), prefixed[2].trim())
      stamps++
      continue
    }
    out.push(t)
  }

  if (stamps < 3) return { ok: false, reason: 'unusable' }
  return { ok: true, text: out.join('\n') }
}

interface TranscribeArgs {
  videoId: string
  language: string
  apiKey: string
  models?: string[]
  /** 測試時換成假的 fetch */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export async function transcribeWithGemini(args: TranscribeArgs): Promise<GeminiResult> {
  const doFetch = args.fetchImpl ?? fetch
  const models = args.models ?? GEMINI_MODELS
  let lastDetail = '沒有可用的模型'

  for (const model of models) {
    for (const optimized of [true, false]) {
      let res: Response
      try {
        res = await doFetch(`${GEMINI_ENDPOINT}/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': args.apiKey },
          body: JSON.stringify(buildBody(args.videoId, args.language, optimized)),
          signal: AbortSignal.timeout(args.timeoutMs ?? 90_000),
        })
      } catch (e) {
        return { ok: false, reason: 'failed', detail: `連不上 Gemini：${String(e)}` }
      }

      // 模型名稱不存在或已下架：換下一個模型
      if (res.status === 404) {
        lastDetail = `${model} 不存在（404）`
        break
      }
      // 省錢設定這一代不認得：拿掉再試一次同一個模型
      if (res.status === 400 && optimized) {
        lastDetail = `${model} 不接受省錢設定（400）`
        continue
      }

      const bodyText = await res.text()
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          reason: 'key_rejected',
          detail: `Gemini 拒絕這把金鑰（${res.status}）：${bodyText.slice(0, 200)}`,
        }
      }
      if (res.status === 429) {
        return { ok: false, reason: 'quota', detail: `Gemini 額度用完（429）：${bodyText.slice(0, 200)}` }
      }
      if (!res.ok) {
        return { ok: false, reason: 'failed', detail: `Gemini 回傳 ${res.status}：${bodyText.slice(0, 200)}` }
      }

      let json: unknown
      try {
        json = JSON.parse(bodyText)
      } catch {
        return { ok: false, reason: 'failed', detail: 'Gemini 回應不是 JSON' }
      }
      const normalized = normalizeTranscript(extractText(json))
      if (!normalized.ok) {
        return {
          ok: false,
          reason: normalized.reason,
          detail: normalized.reason === 'no_speech' ? '影片裡沒有人聲' : 'Gemini 的輸出不像逐字稿（時間戳太少）',
        }
      }
      return { ok: true, text: normalized.text.slice(0, 20000), model }
    }
  }

  return { ok: false, reason: 'failed', detail: lastDetail }
}
