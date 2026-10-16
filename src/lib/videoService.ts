// 影片教材的資料層：推薦搜尋方向、把貼上的逐字稿做成教材
//
// 跟歌曲的分工不同之處：AI **不推薦具體影片**（它記不住哪支存在，
// 會幻想出不存在的頻道與標題），只給搜尋方向；真實影片由 YouTube 搜尋提供。
// 逐字稿也沒有 LRCLIB 那種免費來源，一律由使用者從 YouTube 的
// 「顯示轉錄稿」面板複製貼上。

import { supabase } from './supabase'
import { callClaudeJSON } from './claude'
import { findVideoByQuery } from './songService'
import { loadAccessPassphrase } from './accessGate'
import { parseTranscript, transcriptText } from './transcript'
import {
  isVideoLesson,
  isVideoPickerResult,
  TRANSCRIPT_MAX_CHARS,
  type VideoLesson,
  type VideoLessonInput,
  type VideoPick,
  type VideoPickerInput,
} from './prompts/video'
import type { Level, TaskLanguage, Video } from './types'

export async function listVideos(profileId: string, limit = 100): Promise<Video[]> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as Video[]
}

export async function getVideo(id: string, profileId: string): Promise<Video | null> {
  const { data, error } = await supabase
    .from('videos')
    .select('*')
    .eq('id', id)
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Video | null) ?? null
}

/** 請 AI 給搜尋方向（不是具體影片——它記不住哪支存在） */
export async function suggestSearches(
  language: TaskLanguage,
  level: Level,
  topic: string,
  interests: string | null,
): Promise<VideoPick[]> {
  const result = await callClaudeJSON(
    {
      promptModule: 'videoPicker',
      vars: { language, level, topic, interests: interests ?? undefined } satisfies VideoPickerInput,
      messages: [{ role: 'user', content: '請給我適合的搜尋方向' }],
    },
    isVideoPickerResult,
  )
  return result.picks
}

export interface ResolvedPick extends VideoPick {
  /** 搜到的真實影片；沒設 YOUTUBE_API_KEY 或搜不到能播的時為 null */
  videoId: string | null
  videoTitle: string | null
  durationSec: number | null
}

/**
 * 把搜尋方向變成真實存在、**而且在 App 裡播得出來**的影片。
 *
 * Worker 會先在搜尋時擋掉不能嵌入、台灣看不到的，再逐支確認年齡限制與長度
 * （見 worker/src/youtubeFilter.ts）。搜不到能播的不是錯誤：畫面會改成給一個
 * YouTube 搜尋連結讓使用者自己挑。
 */
export async function resolvePicks(picks: VideoPick[], language: TaskLanguage): Promise<ResolvedPick[]> {
  const found = await Promise.all(picks.map((p) => findVideoByQuery(p.query, { kind: 'video', language })))
  return picks.map((p, i) => ({
    ...p,
    videoId: found[i]?.videoId ?? null,
    videoTitle: found[i]?.videoTitle ?? null,
    durationSec: found[i]?.durationSec ?? null,
  }))
}

/**
 * 沒有 YOUTUBE_API_KEY 時給使用者的搜尋連結，帶上 YouTube 自己的篩選：
 * 4-20 分鐘（擋掉 Shorts 與一小時的直播存檔）＋有字幕。
 *
 * sp 是 YouTube 搜尋頁篩選器的編碼（protobuf 再 base64）：
 *   欄位 2 是篩選器本身，裡面 欄位 3＝長度（3＝4-20 分鐘）、欄位 5＝字幕（1＝有）
 *   → bytes 12 04 18 03 28 01 → "EgQYAygB"
 * 「能不能嵌入」YouTube 的搜尋頁沒有篩選器可用，那一項只能靠貼上之後的檢查。
 * 手機上的 YouTube App 有時會忽略這個參數，那就只是退回普通搜尋，不會壞。
 */
export const YOUTUBE_FILTER_SP = 'EgQYAygB'

export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=${YOUTUBE_FILTER_SP}`
}

/** 播不出來或不適合做教材的原因（跟 worker/src/youtubeFilter.ts 的 PlayProblem 一致） */
export type PlayProblem = 'embed_disabled' | 'not_public' | 'age_restricted' | 'region_blocked' | 'too_short' | 'too_long'

export const PLAY_PROBLEM_NOTE: Record<PlayProblem, string> = {
  embed_disabled: '這支影片的作者關掉了「允許在其他網站播放」，App 裡會聽不到。',
  not_public: '這支影片不是公開影片（或已經被刪除），App 裡會聽不到。',
  age_restricted: '這支影片有年齡限制，嵌在 App 裡一律不會播放。',
  region_blocked: '這支影片在台灣看不到。',
  too_short: '這支太短了（多半是 Shorts），挑不出 8-15 句精聽。',
  too_long: '這支太長了，AI 聽寫只會聽前六分鐘，後面的內容用不到。',
}

export interface VideoCheck {
  /** full＝有 YouTube 金鑰的完整檢查；basic＝只確認能不能嵌入；none＝查不到 */
  checked: 'full' | 'basic' | 'none'
  /** null＝不知道（不擋人） */
  playable: boolean | null
  problem: PlayProblem | null
  title: string
  durationSec: number | null
}

/**
 * 使用者自己貼連結時，先確認這支在 App 裡播不播得出來。
 * 查不到就回 playable: null——不知道的時候不要擋人。
 */
export async function checkVideo(videoId: string): Promise<VideoCheck> {
  const unknown: VideoCheck = { checked: 'none', playable: null, problem: null, title: '', durationSec: null }
  const base = import.meta.env.VITE_WORKER_URL?.replace(/\/$/, '')
  if (!base) return unknown
  const passphrase = loadAccessPassphrase()
  try {
    const res = await fetch(`${base}/api/video-check`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(passphrase ? { 'x-lgl-access': passphrase } : {}),
      },
      body: JSON.stringify({ videoId, kind: 'video' }),
    })
    if (!res.ok) return unknown
    const d = (await res.json()) as Partial<VideoCheck>
    const problems: PlayProblem[] = ['embed_disabled', 'not_public', 'age_restricted', 'region_blocked', 'too_short', 'too_long']
    return {
      checked: d.checked === 'full' || d.checked === 'basic' ? d.checked : 'none',
      playable: typeof d.playable === 'boolean' ? d.playable : null,
      problem: problems.includes(d.problem as PlayProblem) ? (d.problem as PlayProblem) : null,
      title: typeof d.title === 'string' ? d.title : '',
      durationSec: typeof d.durationSec === 'number' ? d.durationSec : null,
    }
  } catch {
    return unknown
  }
}

/** 自動抓逐字稿失敗的原因，每一種的說明不一樣——全部變成「抓不到」等於沒講 */
export type TranscriptMiss = 'blocked' | 'po_token' | 'no_captions' | 'empty' | 'unreachable'

/**
 * 第二層（AI 聽寫）的狀態。not_configured＝Worker 沒設 GEMINI_API_KEY，
 * 其他是設了但這次失敗的原因。
 */
export type AiTranscribeStatus = 'not_configured' | 'no_speech' | 'unusable' | 'quota' | 'key_rejected' | 'failed'

export interface FetchedTranscript {
  /** 跟 YouTube 轉錄稿面板同格式（時間一行、內容一行） */
  text: string
  lang: string
  /** 自動辨識的字幕（會有錯字，但那是真實情況，教材不會幫它亂改） */
  auto: boolean
  /** youtube＝抓到影片自己的字幕；ai＝Gemini 聽影片寫出來的 */
  source: 'youtube' | 'ai'
}

export interface TranscriptMissResult {
  miss: TranscriptMiss
  /** 沒走到第二層（舊版 Worker）時為 null */
  ai: AiTranscribeStatus | null
  /** Gemini 那邊失敗的技術細節（狀態碼與回應片段）。使用者看不懂，但貼給開發者就查得到原因 */
  aiDetail: string | null
}

export const TRANSCRIPT_MISS_NOTE: Record<TranscriptMiss, string> = {
  blocked: 'YouTube 擋掉了我們伺服器的 IP。這是常態不是壞掉——機房 IP 一律會被當成機器人。',
  po_token: '這支影片的字幕要播放器簽章才拿得到，伺服器簽不出來。',
  no_captions: '這支影片沒有字幕可以抓。',
  empty: '抓到的字幕是空的。',
  unreachable: '連不上 YouTube，等一下再試一次。',
}

/** AI 聽寫失敗時的白話說明；not_configured 給的是「怎麼開」而不是「哪裡壞」 */
export const AI_TRANSCRIBE_NOTE: Record<AiTranscribeStatus, string> = {
  not_configured:
    '還沒開 AI 聽寫。在 Cloudflare 的 Worker 設定裡加上 GEMINI_API_KEY，之後字幕抓不到時就會自動改用 AI 聽寫。',
  no_speech: 'AI 聽完了，但這支影片裡沒有人在講話。',
  unusable: 'AI 聽寫出來的東西不像逐字稿（比較像摘要），沒辦法拿來做逐句精聽。換一支或再試一次。',
  quota: '今天的 AI 聽寫額度用完了，明天會恢復。',
  key_rejected:
    'Gemini 拒絕了這把金鑰。到 Google Cloud 確認金鑰的 API 限制有勾 Generative Language API，或改用 AI Studio 開的金鑰。',
  failed: 'AI 聽寫這次沒成功，等一下再試一次。',
}

/**
 * 抓逐字稿：Worker 先免費試抓影片自己的字幕，抓不到且有設 Gemini 金鑰時，
 * 改讓 AI 直接聽影片（最多約 40 秒）。兩層都不行才退回請使用者貼上。
 */
export async function fetchTranscript(
  videoId: string,
  language: TaskLanguage,
): Promise<FetchedTranscript | TranscriptMissResult> {
  const base = import.meta.env.VITE_WORKER_URL?.replace(/\/$/, '')
  if (!base) return { miss: 'unreachable', ai: null, aiDetail: null }

  // 這支不共用 songService 的 postWorker：那支失敗時只回 null，
  // 而這裡失敗的「原因」正是要給使用者看的東西（擋 IP／沒字幕／要簽章
  // 是三件完全不同的事，混成一句「抓不到」就等於沒講）
  const passphrase = loadAccessPassphrase()
  try {
    const res = await fetch(`${base}/api/transcript`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(passphrase ? { 'x-lgl-access': passphrase } : {}),
      },
      body: JSON.stringify({ videoId, language }),
    })
    const data = (await res.json().catch(() => null)) as {
      text?: string
      lang?: string
      auto?: boolean
      source?: string
      reason?: string
      ai?: string
      ai_detail?: string
    } | null

    if (res.ok && data?.text) {
      return {
        text: data.text,
        lang: data.lang ?? '',
        auto: data.auto === true,
        source: data.source === 'ai' ? 'ai' : 'youtube',
      }
    }

    const known: TranscriptMiss[] = ['blocked', 'po_token', 'no_captions', 'empty', 'unreachable']
    const knownAi: AiTranscribeStatus[] = ['not_configured', 'no_speech', 'unusable', 'quota', 'key_rejected', 'failed']
    const reason = data?.reason
    const ai = data?.ai
    return {
      miss: known.includes(reason as TranscriptMiss) ? (reason as TranscriptMiss) : 'unreachable',
      ai: knownAi.includes(ai as AiTranscribeStatus) ? (ai as AiTranscribeStatus) : null,
      aiDetail: typeof data?.ai_detail === 'string' ? data.ai_detail : null,
    }
  } catch {
    return { miss: 'unreachable', ai: null, aiDetail: null }
  }
}

/** 把貼上的逐字稿做成一段教材並存起來 */
export async function createVideo(
  profileId: string,
  language: TaskLanguage,
  level: Level,
  title: string,
  youtubeId: string,
  rawTranscript: string,
): Promise<Video> {
  // 時間戳留在原文裡（分段播放要用），但送進 prompt 的是純文字——
  // 時間戳對教學毫無幫助，只會白白吃掉 token
  const parsed = parseTranscript(rawTranscript)
  const transcript = rawTranscript.slice(0, TRANSCRIPT_MAX_CHARS)
  const forPrompt = transcriptText(parsed).slice(0, TRANSCRIPT_MAX_CHARS)

  const lesson = await callClaudeJSON(
    {
      promptModule: 'videoLesson',
      vars: { language, level, title, transcript: forPrompt } satisfies VideoLessonInput,
      messages: [{ role: 'user', content: '請把這段影片做成聽力教材' }],
    },
    isVideoLesson,
  )

  const { data, error } = await supabase
    .from('videos')
    .insert({
      profile_id: profileId,
      language,
      title: title.trim(),
      youtube_id: youtubeId,
      transcript,
      lesson,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Video
}

export async function deleteVideo(id: string, profileId: string): Promise<void> {
  const { error } = await supabase.from('videos').delete().eq('id', id).eq('profile_id', profileId)
  if (error) throw new Error(error.message)
}

/** 從 jsonb 取出教材，壞掉就回 null（畫面顯示「這支要重做」） */
export function readVideoLesson(video: Video): VideoLesson | null {
  return isVideoLesson(video.lesson) ? video.lesson : null
}
