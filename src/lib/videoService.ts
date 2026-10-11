// 影片教材的資料層：推薦搜尋方向、把貼上的逐字稿做成教材
//
// 跟歌曲的分工不同之處：AI **不推薦具體影片**（它記不住哪支存在，
// 會幻想出不存在的頻道與標題），只給搜尋方向；真實影片由 YouTube 搜尋提供。
// 逐字稿也沒有 LRCLIB 那種免費來源，一律由使用者從 YouTube 的
// 「顯示轉錄稿」面板複製貼上。

import { supabase } from './supabase'
import { callClaudeJSON } from './claude'
import { findVideoByQuery } from './songService'
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
      maxTokens: 2000,
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
      maxTokens: 2500,
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
