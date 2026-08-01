// 單字卡資料層：到期查詢、新字補充（內建字表 → AI 補完）、排程寫回
import { supabase } from './supabase'
import { callClaudeJSON } from './claude'
import {
  isVocabEnrichResult,
  normalizeEnriched,
  type VocabEnrichInput,
  type VocabEnrichResult,
} from './prompts/vocabEnrich'
import { seedsFor, type ExamSystem } from '../data/vocabLists'
import { nextDueDate, schedule, toDateString, type Grade, type SrsState } from './srs'
import { asTaskLanguage } from './types'
import type { Language, VocabCard } from './types'

/** 一次 AI 補完的字數上限（控制回應長度與等待時間） */
const ENRICH_BATCH = 10

export interface VocabStats {
  due: number
  learning: number
  mastered: number
  total: number
}

export async function getVocabStats(profileId: string, language: Language): Promise<VocabStats> {
  const { data, error } = await supabase
    .from('vocab_cards')
    .select('stage, due_date')
    .eq('profile_id', profileId)
    .eq('language', language)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as Array<{ stage: number; due_date: string }>
  const today = toDateString(new Date())
  return {
    due: rows.filter((r) => r.stage < 5 && r.due_date <= today).length,
    learning: rows.filter((r) => r.stage > 0 && r.stage < 5).length,
    mastered: rows.filter((r) => r.stage >= 5).length,
    total: rows.length,
  }
}

/** 今天到期的卡（含未學過的新卡），依到期日排序 */
export async function getDueCards(
  profileId: string,
  language: Language,
  limit: number,
): Promise<VocabCard[]> {
  const { data, error } = await supabase
    .from('vocab_cards')
    .select('*')
    .eq('profile_id', profileId)
    .eq('language', language)
    .lt('stage', 5)
    .lte('due_date', toDateString(new Date()))
    .order('due_date')
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as VocabCard[]
}

/** 使用者已有的字（用來去重） */
async function getKnownWords(profileId: string, language: Language): Promise<string[]> {
  const { data, error } = await supabase
    .from('vocab_cards')
    .select('word')
    .eq('profile_id', profileId)
    .eq('language', language)
  if (error) throw new Error(error.message)
  return ((data ?? []) as Array<{ word: string }>).map((r) => r.word)
}

/**
 * 補進 count 張新卡：先從內建字表挑沒學過的，不夠再請 AI 生成。
 * 兩種來源都會經過 AI 補完例句與搭配詞，回傳新建立的卡片。
 */
export async function addNewCards(
  profileId: string,
  language: Language,
  exam: string,
  examLevel: string,
  count: number,
): Promise<VocabCard[]> {
  if (count <= 0) return []

  const known = await getKnownWords(profileId, language)
  const knownSet = new Set(known.map((w) => w.toLowerCase()))

  const wanted = Math.min(count, ENRICH_BATCH)
  const seeds = seedsFor(exam as ExamSystem, examLevel)
    .filter((s) => !knownSet.has(s.w.toLowerCase()))
    .slice(0, wanted)

  const fromList = seeds.length > 0
  const result = await callClaudeJSON<VocabEnrichResult>(
    {
      promptModule: 'vocabEnrich',
      vars: {
        language: asTaskLanguage(language),
        exam,
        examLevel,
        seeds,
        count: wanted,
        known,
      } satisfies VocabEnrichInput,
      messages: [{ role: 'user', content: fromList ? '請補完這批單字' : '請產生新單字' }],
      maxTokens: 3000,
    },
    isVocabEnrichResult,
  )

  const seedByWord = new Map(seeds.map((s) => [s.w.toLowerCase(), s]))
  const rows = result.words
    .map(normalizeEnriched)
    .filter((w) => w.word !== '' && !knownSet.has(w.word.toLowerCase()))
    .slice(0, wanted)
    .map((w) => {
      const seed = seedByWord.get(w.word.toLowerCase())
      return {
        profile_id: profileId,
        language,
        word: w.word,
        reading: w.reading,
        // 內建字表的中文較穩定，優先採用
        meaning_zh: seed?.zh || w.meaning_zh,
        pos: seed?.pos || w.pos,
        example: w.example,
        example_zh: w.example_zh,
        collocations: w.collocations,
        exam,
        exam_level: examLevel,
        source: seed ? 'list' : 'ai',
      }
    })

  if (rows.length === 0) return []

  const { data, error } = await supabase
    .from('vocab_cards')
    .upsert(rows, { onConflict: 'profile_id,language,word', ignoreDuplicates: true })
    .select()
  if (error) throw new Error(error.message)
  return (data ?? []) as VocabCard[]
}

/** 作答後寫回排程 */
export async function gradeCard(card: VocabCard, grade: Grade): Promise<VocabCard> {
  const state: SrsState = {
    stage: card.stage,
    ease: card.ease,
    intervalDays: card.interval_days,
    repetitions: card.repetitions,
    lapses: card.lapses,
  }
  const next = schedule(state, grade)

  const patch = {
    stage: next.stage,
    ease: next.ease,
    interval_days: next.intervalDays,
    repetitions: next.repetitions,
    lapses: next.lapses,
    due_date: nextDueDate(next),
  }

  const { data, error } = await supabase
    .from('vocab_cards')
    .update(patch)
    .eq('id', card.id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as VocabCard
}

/**
 * 任務生字自動入庫（閱讀語塊、批改的用字類錯誤）。
 * 已存在的字不會覆蓋既有學習進度。
 */
export async function harvestFromTask(
  profileId: string,
  language: Language,
  items: Array<{ word: string; meaning_zh: string; example?: string }>,
): Promise<number> {
  const cleaned = items
    .map((i) => ({ ...i, word: i.word.trim() }))
    .filter((i) => i.word !== '' && i.word.length <= 60)
  if (cleaned.length === 0) return 0

  const rows = cleaned.map((i) => ({
    profile_id: profileId,
    language,
    word: i.word,
    reading: '',
    meaning_zh: i.meaning_zh,
    pos: '',
    example: i.example ?? '',
    example_zh: '',
    collocations: [],
    exam: '',
    exam_level: '',
    source: 'task',
  }))

  const { data, error } = await supabase
    .from('vocab_cards')
    .upsert(rows, { onConflict: 'profile_id,language,word', ignoreDuplicates: true })
    .select('id')
  if (error) throw new Error(error.message)
  return (data ?? []).length
}

/** 供任務生成器參考的學習中單字（讓新任務自然用到這些字） */
export async function getWordsForTask(
  profileId: string,
  language: Language,
  limit = 8,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('vocab_cards')
    .select('word')
    .eq('profile_id', profileId)
    .eq('language', language)
    .gt('stage', 0)
    .lt('stage', 5)
    .order('due_date')
    .limit(limit)
  if (error) return []
  return ((data ?? []) as Array<{ word: string }>).map((r) => r.word)
}
