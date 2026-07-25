// 虛詞練習的純邏輯：驗證 AI 回應、組出選擇題選項——不依賴 Supabase，可獨立測試
import { CLASSICAL_PARTICLES, getParticleEntry, type ParticleEntry, type ParticleSense } from '../data/classicalParticles'
import type { ParticleAnswerRaw } from './prompts/particleTutor'

export interface ValidatedParticleAnswer {
  word: string
  sentence: string
  senseId: string
  explain: string
}

/**
 * 驗證 AI 回應：senseId 必須在該字的合法分類內，sentence 必須是我們真的
 * 送出去的那句（防止 AI 生造句子或分類混進練習）。任一項對不上就整條捨棄。
 */
export function validateParticleAnswers(
  raw: ParticleAnswerRaw[],
  sentByWord: Record<string, string[]>,
): ValidatedParticleAnswer[] {
  const out: ValidatedParticleAnswer[] = []
  for (const a of raw) {
    const entry = getParticleEntry(a.word)
    if (!entry) continue
    if (!entry.senses.some((s) => s.id === a.senseId)) continue
    const sentences = sentByWord[a.word] ?? []
    if (!sentences.includes(a.sentence)) continue
    out.push({ word: a.word, sentence: a.sentence, senseId: a.senseId, explain: a.explain })
  }
  return out
}

function shuffle<T>(list: T[]): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** 組出選擇題選項：正解 + 同一個字的其他用法當干擾選項，最多 4 個 */
export function buildSenseOptions(entry: ParticleEntry, correctSenseId: string, maxOptions = 4): ParticleSense[] {
  const correct = entry.senses.find((s) => s.id === correctSenseId)
  if (!correct) return shuffle(entry.senses).slice(0, maxOptions)
  const distractors = shuffle(entry.senses.filter((s) => s.id !== correctSenseId)).slice(0, maxOptions - 1)
  return shuffle([correct, ...distractors])
}

export { CLASSICAL_PARTICLES, getParticleEntry }
