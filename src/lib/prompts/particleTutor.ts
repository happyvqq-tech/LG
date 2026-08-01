// 虛詞用法判斷：給真實古文觀止句子，請 AI 從固定分類中挑出正確用法
//
// 安全設計：句子是從語料庫抽出的真實文字（不是 AI 生成），AI 只需要從
// 「這個字在這句話裡列出的固定選項中挑一個」——回應的 senseId 會逐一比對
// 是否在該字的合法選項內、sentence 是否為我們真的送出去的那一句，任何
// 對不上的都直接捨棄，不會讓 AI 生造出分類外的答案進入練習。

import type { ParticleEntry } from '../../data/classicalParticles'

export interface ParticleQuizInput {
  /** 每個待練習的虛詞，附它的合法分類與這次抽到的句子 */
  items: Array<{ entry: ParticleEntry; sentences: string[] }>
}

export interface ParticleAnswerRaw {
  word: string
  sentence: string
  senseId: string
  explain: string
}

export interface ParticleQuizResult {
  answers: ParticleAnswerRaw[]
}

export function isParticleQuizResult(v: unknown): v is ParticleQuizResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.answers) || o.answers.length === 0) return false
  return o.answers.every((a) => {
    if (typeof a !== 'object' || a === null) return false
    const item = a as Record<string, unknown>
    return (
      typeof item.word === 'string' &&
      typeof item.sentence === 'string' &&
      typeof item.senseId === 'string' &&
      typeof item.explain === 'string'
    )
  })
}
