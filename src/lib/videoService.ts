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
  /** 搜到的真實影片；沒設 YOUTUBE_API_KEY 或搜不到時為 null */
  videoId: string | null
  videoTitle: string | null
}

/**
 * 把搜尋方向變成真實存在的影片。
 *
 * 搜不到不是錯誤：沒設 YOUTUBE_API_KEY 的部署一律回 null，
 * 畫面會改成給一個 YouTube 搜尋連結讓使用者自己挑——
 * 自己挑其實更好，因為他看得到縮圖與長度。
 */
export async function resolvePicks(picks: VideoPick[]): Promise<ResolvedPick[]> {
  const found = await Promise.all(picks.map((p) => findVideoByQuery(p.query)))
  return picks.map((p, i) => ({
    ...p,
    videoId: found[i]?.videoId ?? null,
    videoTitle: found[i]?.videoTitle ?? null,
  }))
}

/** 自動抓逐字稿失敗的原因，每一種的說明不一樣——全部變成「抓不到」等於沒講 */
export type TranscriptMiss = 'blocked' | 'po_token' | 'no_captions' | 'empty' | 'unreachable'

export interface FetchedTranscript {
  /** 跟 YouTube 轉錄稿面板同格式（時間一行、內容一行） */
  text: string
  lang: string
  /** 自動辨識的字幕（會有錯字，但那是真實情況，教材不會幫它亂改） */
  auto: boolean
}

export const TRANSCRIPT_MISS_NOTE: Record<TranscriptMiss, string> = {
  blocked: 'YouTube 擋掉了我們伺服器的 IP。這是常態不是壞掉——機房 IP 一律會被當成機器人。',
  po_token: '這支影片的字幕要播放器簽章才拿得到，伺服器簽不出來。',
  no_captions: '這支影片沒有字幕可以抓。',
  empty: '抓到的字幕是空的。',
  unreachable: '連不上 YouTube，等一下再試一次。',
}

/**
 * 盡力試抓一次逐字稿。
 *
 * **預期常常失敗，而且那沒關係**：抓不到就退回請使用者貼上，
 * 跟沒有這支功能一模一樣。詳細理由見 worker/src/index.ts 的 handleTranscript。
 */
export async function fetchTranscript(
  videoId: string,
  language: TaskLanguage,
): Promise<FetchedTranscript | { miss: TranscriptMiss }> {
  const base = import.meta.env.VITE_WORKER_URL?.replace(/\/$/, '')
  if (!base) return { miss: 'unreachable' }

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
      reason?: string
    } | null

    if (res.ok && data?.text) return { text: data.text, lang: data.lang ?? '', auto: data.auto === true }

    const known: TranscriptMiss[] = ['blocked', 'po_token', 'no_captions', 'empty', 'unreachable']
    const reason = data?.reason
    return { miss: known.includes(reason as TranscriptMiss) ? (reason as TranscriptMiss) : 'unreachable' }
  } catch {
    return { miss: 'unreachable' }
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
