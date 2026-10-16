// YouTube 影片「在 App 裡播不播得出來」的判斷——純函式，可獨立測試
//
// ── 為什麼要在推薦時就先過濾 ───────────────────────────────
//
// 使用者回報：挑來的影片很多在 App 裡聽不到。原因幾乎都是這幾種，
// 而它們在 YouTube 網站上看起來都正常，只有嵌進別的網站時才會壞：
//   1. 影片作者關掉「允許嵌入」——嵌入框只會顯示「影片無法播放」
//   2. 地區限制——在台灣看不到
//   3. 年齡限制——嵌入框一律不播
//   4. 不是公開影片（不公開／私人）
// 另外兩種播得出來，但做不成教材：
//   5. 太短（Shorts）——挑不出 8-15 行精聽
//   6. 太長——只會聽前六分鐘，後面的內容用不到，還容易讓人選錯段落
//
// YouTube Data API 的 videos.list 一次就能拿到上面全部資訊，而且只要 1 單位配額
// （搜尋一次要 100），所以搜尋後多查這一步幾乎不花成本。

/** 這個家庭在台灣，地區限制以台灣為準 */
export const VIEWER_REGION = 'TW'

export type VideoKind = 'song' | 'video'

/** 播不出來或不適合做教材的原因 */
export type PlayProblem =
  | 'embed_disabled'
  | 'not_public'
  | 'age_restricted'
  | 'region_blocked'
  | 'too_short'
  | 'too_long'

export interface VideoDetail {
  id: string
  title: string
  embeddable: boolean
  isPublic: boolean
  ageRestricted: boolean
  regionBlocked: boolean
  durationSec: number | null
  hasCaptions: boolean
}

/**
 * 各種素材可接受的長度（秒）。
 * 影片：3-25 分鐘。太短挑不出段落，太長只會聽前六分鐘、後面浪費。
 * 歌曲：1-15 分鐘。擋掉 Shorts 剪輯與整張專輯／一小時循環版。
 */
const LENGTH: Record<VideoKind, { min: number; max: number }> = {
  video: { min: 180, max: 1500 },
  song: { min: 60, max: 900 },
}

/** ISO 8601 的影片長度（PT1H2M3S）轉成秒；看不懂就回 null，交給呼叫端當「不知道」 */
export function parseIsoDuration(s: string | undefined): number | null {
  if (!s) return null
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(s)
  if (!m) return null
  const [, d, h, min, sec] = m
  const total = Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(sec ?? 0)
  return total
}

interface ApiVideoItem {
  id?: string
  snippet?: { title?: string }
  status?: { embeddable?: boolean; privacyStatus?: string }
  contentDetails?: {
    duration?: string
    caption?: string
    regionRestriction?: { allowed?: string[]; blocked?: string[] }
    contentRating?: { ytRating?: string }
  }
}

/** videos.list 的一筆 → 我們關心的欄位 */
export function toDetail(item: unknown, region = VIEWER_REGION): VideoDetail | null {
  const v = item as ApiVideoItem
  if (!v?.id) return null
  const rr = v.contentDetails?.regionRestriction
  // allowed 存在時是白名單：不在名單裡就看不到；blocked 是黑名單
  const regionBlocked =
    (Array.isArray(rr?.allowed) && !rr.allowed.includes(region)) ||
    (Array.isArray(rr?.blocked) && rr.blocked.includes(region))

  return {
    id: v.id,
    title: v.snippet?.title ?? '',
    embeddable: v.status?.embeddable === true,
    isPublic: v.status?.privacyStatus === 'public',
    ageRestricted: v.contentDetails?.contentRating?.ytRating === 'ytAgeRestricted',
    regionBlocked,
    durationSec: parseIsoDuration(v.contentDetails?.duration),
    hasCaptions: v.contentDetails?.caption === 'true',
  }
}

/** 第一個擋下它的原因；沒問題就回 null。順序是「最根本的先講」 */
export function playProblem(d: VideoDetail, kind: VideoKind): PlayProblem | null {
  if (!d.isPublic) return 'not_public'
  if (!d.embeddable) return 'embed_disabled'
  if (d.regionBlocked) return 'region_blocked'
  if (d.ageRestricted) return 'age_restricted'
  // 長度不知道就放行：寧可多一支可能偏短的，也不要因為 API 少回一個欄位就全部擋掉
  if (d.durationSec !== null) {
    if (d.durationSec < LENGTH[kind].min) return 'too_short'
    if (d.durationSec > LENGTH[kind].max) return 'too_long'
  }
  return null
}

/**
 * 從搜尋結果裡挑一支播得出來的。
 *
 * 影片模組優先挑有字幕的：第一層免費試抓才有機會成功（省下 AI 聽寫），
 * 而且有上字幕的頻道通常製作比較用心。但不強求——沒字幕的還有 AI 聽寫可以補。
 * 其餘維持搜尋結果的順序（YouTube 的相關度排序比我們猜得準）。
 */
export function pickPlayable(details: VideoDetail[], kind: VideoKind): VideoDetail | null {
  const ok = details.filter((d) => playProblem(d, kind) === null)
  if (ok.length === 0) return null
  if (kind === 'video') return ok.find((d) => d.hasCaptions) ?? ok[0]
  return ok[0]
}
