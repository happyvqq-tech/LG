// 虛詞專練資料層：確保 18 張卡存在、抽真實語料例句、呼叫 AI 判斷用法、SRS 排程
import { supabase } from './supabase'
import { CLASSICAL_PARTICLES, CLASSICAL_PARTICLE_WORDS, getParticleEntry } from '../data/classicalParticles'
import { findClauses } from './particleCorpus'
import { validateParticleAnswers, buildSenseOptions } from './particleRules'
import { callClaudeJSON } from './claude'
import {
  particleTutorSystemPrompt,
  isParticleQuizResult,
  type ParticleQuizResult,
} from './prompts/particleTutor'
import { nextDueDate, schedule, toDateString, type Grade } from './srs'
import type { ParticleCard } from './types'
import type { ParticleSense } from '../data/classicalParticles'

const LANGUAGE = '古文'
/** 一次複習最多幾個到期的虛詞 */
const SESSION_CAP = 8

/** 確保這位成員的 18 張虛詞卡都存在，缺的補上（新卡今天就到期） */
async function ensureCards(profileId: string): Promise<void> {
  const { data, error } = await supabase
    .from('particle_cards')
    .select('word')
    .eq('profile_id', profileId)
    .eq('language', LANGUAGE)
  if (error) throw new Error(error.message)

  const existing = new Set(((data ?? []) as Array<{ word: string }>).map((r) => r.word))
  const missing = CLASSICAL_PARTICLE_WORDS.filter((w) => !existing.has(w))
  if (missing.length === 0) return

  const today = toDateString(new Date())
  const { error: insertError } = await supabase.from('particle_cards').insert(
    missing.map((word) => ({ profile_id: profileId, language: LANGUAGE, word, due_date: today })),
  )
  if (insertError) throw new Error(insertError.message)
}

/** 到期的虛詞卡數量（會先確保 18 張卡都存在，供首頁徽章顯示） */
export async function getDueParticleCount(profileId: string): Promise<number> {
  await ensureCards(profileId)
  const { count, error } = await supabase
    .from('particle_cards')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', profileId)
    .eq('language', LANGUAGE)
    .lte('due_date', toDateString(new Date()))
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function getDueCards(profileId: string): Promise<ParticleCard[]> {
  await ensureCards(profileId)
  const { data, error } = await supabase
    .from('particle_cards')
    .select('*')
    .eq('profile_id', profileId)
    .eq('language', LANGUAGE)
    .lte('due_date', toDateString(new Date()))
    .order('due_date')
    .limit(SESSION_CAP)
  if (error) throw new Error(error.message)
  return (data ?? []) as ParticleCard[]
}

export interface ParticleQuestion {
  card: ParticleCard
  sentence: string
  correctSenseId: string
  options: ParticleSense[]
  explain: string
}

/**
 * 組一輪練習：抓到期的虛詞卡 → 各抽一句真實語料 → 一次 AI 呼叫判斷用法 →
 * 驗證後組成選擇題。AI 判斷不合格的字這輪就跳過（下次還會到期，不會遺失）。
 */
export async function buildParticleSession(profileId: string): Promise<ParticleQuestion[]> {
  const due = await getDueCards(profileId)
  if (due.length === 0) return []

  const sentByWord: Record<string, string[]> = {}
  const items: Array<{ entry: (typeof CLASSICAL_PARTICLES)[number]; sentences: string[] }> = []

  for (const card of due) {
    const entry = getParticleEntry(card.word)
    if (!entry) continue
    const sentences = await findClauses(card.word, 1)
    if (sentences.length === 0) continue
    sentByWord[card.word] = sentences
    items.push({ entry, sentences })
  }
  if (items.length === 0) return []

  const result = await callClaudeJSON<ParticleQuizResult>(
    {
      module: 'grader',
      system: particleTutorSystemPrompt({ items }),
      messages: [{ role: 'user', content: '請判斷這些句子的虛詞用法' }],
      maxTokens: 2500,
    },
    isParticleQuizResult,
  )

  const validated = validateParticleAnswers(result.answers, sentByWord)
  const cardByWord = new Map(due.map((c) => [c.word, c]))

  const questions: ParticleQuestion[] = []
  for (const a of validated) {
    const card = cardByWord.get(a.word)
    const entry = getParticleEntry(a.word)
    if (!card || !entry) continue
    questions.push({
      card,
      sentence: a.sentence,
      correctSenseId: a.senseId,
      options: buildSenseOptions(entry, a.senseId, 4),
      explain: a.explain,
    })
  }
  return questions
}

/** 作答後寫回排程（沿用單字模組同一套 SM-2） */
export async function gradeParticleCard(card: ParticleCard, grade: Grade): Promise<void> {
  const next = schedule(
    {
      stage: card.stage,
      ease: card.ease,
      intervalDays: card.interval_days,
      repetitions: card.repetitions,
      lapses: card.lapses,
    },
    grade,
  )
  const { error } = await supabase
    .from('particle_cards')
    .update({
      stage: next.stage,
      ease: next.ease,
      interval_days: next.intervalDays,
      repetitions: next.repetitions,
      lapses: next.lapses,
      due_date: nextDueDate(next),
    })
    .eq('id', card.id)
  if (error) throw new Error(error.message)
}
