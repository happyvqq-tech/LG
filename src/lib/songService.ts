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
import type { Level, Song, TaskLanguage } from './types'

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
      segment_index: 0,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Song
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
