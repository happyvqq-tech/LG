// 歌曲教材的資料層：推薦歌單、建立教材、讀寫進度
//
// 分工刻意跟其他模組不同：AI 只負責「挑歌」與「分析歌詞」，
// 歌詞本身一律由使用者貼上。原因見 worker/src/prompts/songPicker.ts——
// 模型憑記憶背的歌詞會錯字漏行，而教錯的歌詞比不教更糟。

import { supabase } from './supabase'
import { callClaudeJSON } from './claude'
import {
  isSongLesson,
  isSongPickerResult,
  tidyLyrics,
  type SongLesson,
  type SongLessonInput,
  type SongPickerInput,
  type SongSuggestion,
} from './prompts/song'
import { loadAccessPassphrase } from './accessGate'
import type { Level, Song, TaskLanguage } from './types'

/** 要跟 worker/src/index.ts 的 ACCESS_HEADER 一致（claude.ts、googleTts.ts 也是同一個） */
const ACCESS_HEADER = 'x-lgl-access'

function workerBase(): string | null {
  const url = import.meta.env.VITE_WORKER_URL
  return url ? url.replace(/\/$/, '') : null
}

async function postWorker<T>(path: string, body: unknown): Promise<T | null> {
  const base = workerBase()
  if (!base) return null
  const passphrase = loadAccessPassphrase()
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(passphrase ? { [ACCESS_HEADER]: passphrase } : {}),
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export interface FetchedLyrics {
  plain: string
  /** LRC 格式的同步歌詞；查到的版本不一定有 */
  synced: string
  matchedTitle: string
  matchedArtist: string
}

/**
 * 自動查歌詞。查不到一律回 null，呼叫端改成請使用者自己貼——
 * 社群歌詞庫不可能收錄所有歌，查不到是正常情況不是錯誤。
 */
export function fetchLyrics(track: string, artist: string): Promise<FetchedLyrics | null> {
  return postWorker<FetchedLyrics>('/api/lyrics', { track, artist }).then((r) =>
    r && (r.plain || r.synced) ? r : null,
  )
}

/**
 * 找原曲影片。沒設 YOUTUBE_API_KEY 的部署會回 null，
 * 呼叫端改成請使用者貼一次連結。
 */
export function findVideo(track: string, artist: string): Promise<string | null> {
  return findVideoByQuery(`${artist} ${track} official audio`).then((r) => r?.videoId ?? null)
}

/**
 * 通用的 YouTube 搜尋（影片模組也用這支）。
 * 沒設 YOUTUBE_API_KEY 的部署會回 null，呼叫端改成讓使用者自己挑。
 */
export function findVideoByQuery(q: string): Promise<{ videoId: string; videoTitle: string } | null> {
  return postWorker<{ videoId?: string; videoTitle?: string }>('/api/youtube', { q }).then((r) =>
    r?.videoId ? { videoId: r.videoId, videoTitle: r.videoTitle ?? '' } : null,
  )
}

/** 從各種 YouTube 網址寫法裡挖出影片 ID；本來就是 ID 的話原樣回傳 */
export function parseYouTubeId(input: string): string | null {
  const s = input.trim()
  if (/^[\w-]{11}$/.test(s)) return s
  const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([\w-]{11})/)
  return m ? m[1] : null
}

export async function listSongs(
  profileId: string,
  language: TaskLanguage,
  limit = 50,
): Promise<Song[]> {
  const { data, error } = await supabase
    .from('songs')
    .select('*')
    .eq('profile_id', profileId)
    .eq('language', language)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as Song[]
}

/**
 * 這個成員的所有歌曲，不分語言。
 *
 * 為什麼需要一支不篩語言的：歌單頁回來時語言會重設成第一個學習語言，
 * 同時學兩種語言的人會發現剛做好的教材「不見了」——其實只是被篩掉。
 * 教材庫也要用這支，那裡本來就是「所有生成過的東西都在這」。
 */
export async function listAllSongs(profileId: string, limit = 100): Promise<Song[]> {
  const { data, error } = await supabase
    .from('songs')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as Song[]
}

export async function getSong(id: string, profileId: string): Promise<Song | null> {
  const { data, error } = await supabase
    .from('songs')
    .select('*')
    .eq('id', id)
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Song | null) ?? null
}

/** 請 AI 推薦歌單。不含歌詞，只有歌名、兩個分數、推薦理由與缺點 */
export async function suggestSongs(
  language: TaskLanguage,
  level: Level,
  interests: string | null,
  exclude: string[],
): Promise<SongSuggestion[]> {
  const result = await callClaudeJSON(
    {
      promptModule: 'songPicker',
      vars: {
        language,
        level,
        interests: interests ?? undefined,
        exclude,
      } satisfies SongPickerInput,
      messages: [{ role: 'user', content: '請推薦適合的歌' }],
      maxTokens: 2000,
    },
    isSongPickerResult,
  )
  return result.songs
}

/** 把貼上的歌詞做成一課並存起來 */
export async function createSong(
  profileId: string,
  language: TaskLanguage,
  level: Level,
  title: string,
  artist: string,
  rawLyrics: string,
  synced?: string | null,
  youtubeId?: string | null,
): Promise<Song> {
  const lyrics = tidyLyrics(rawLyrics)

  const lesson = await callClaudeJSON(
    {
      promptModule: 'songLesson',
      vars: { language, level, title, artist, lyrics } satisfies SongLessonInput,
      messages: [{ role: 'user', content: '請把這首歌做成教材' }],
      maxTokens: 4000,
    },
    isSongLesson,
  )

  const { data, error } = await supabase
    .from('songs')
    .insert({
      profile_id: profileId,
      language,
      title: title.trim(),
      artist: artist.trim(),
      lyrics,
      lesson,
      synced: synced || null,
      youtube_id: youtubeId || null,
      segment_index: 0,
    })
    .select()
    .single()
  // 還沒跑 migration-014 的資料庫沒有那兩欄，整首歌不該因此存不進去——
  // 拿掉再存一次，就只是少了分段播放，逐行教材照常可用
  if (error) {
    const retry = await supabase
      .from('songs')
      .insert({ profile_id: profileId, language, title: title.trim(), artist: artist.trim(), lyrics, lesson, segment_index: 0 })
      .select()
      .single()
    if (retry.error) throw new Error(retry.error.message)
    return retry.data as Song
  }
  return data as Song
}

/** 補上原曲影片（使用者後來才貼連結）。失敗就算了，下次再貼 */
export async function saveVideoId(id: string, youtubeId: string): Promise<void> {
  await supabase.from('songs').update({ youtube_id: youtubeId }).eq('id', id)
}

/** 記住學到第幾段。失敗不該擋住學習流程——下次回來從頭看一遍而已 */
export async function saveSegmentIndex(id: string, index: number): Promise<void> {
  await supabase.from('songs').update({ segment_index: index }).eq('id', id)
}

export async function deleteSong(id: string, profileId: string): Promise<void> {
  const { error } = await supabase.from('songs').delete().eq('id', id).eq('profile_id', profileId)
  if (error) throw new Error(error.message)
}

/** 從 jsonb 欄位取出教材，壞掉就回 null（畫面顯示「這首需要重做」） */
export function readLesson(song: Song): SongLesson | null {
  return isSongLesson(song.lesson) ? song.lesson : null
}
