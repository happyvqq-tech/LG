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

export function particleTutorSystemPrompt(input: ParticleQuizInput): string {
  const blocks = input.items
    .map(({ entry, sentences }) => {
      const senseList = entry.senses.map((s) => `  - ${s.id}：${s.label}（${s.desc}）`).join('\n')
      const sentenceList = sentences.map((s, i) => `  ${i + 1}. ${s}`).join('\n')
      return `字「${entry.word}」的可能用法：\n${senseList}\n這個字要判斷的句子：\n${sentenceList}`
    })
    .join('\n\n')

  return `你是文言文虛詞教學老師，服務對象是台灣的高中～大學程度學習者。

以下每個虛詞都附了它「所有可能的用法分類」與幾句《古文觀止》真實原文（句子裡都恰好出現一次這個字）。
請針對每一句，判斷句中這個字屬於哪一種用法。

${blocks}

硬性要求：
1. senseId 必須是該字用法清單裡列出的 id，一個字都不能改，不可以自己發明新的分類
2. sentence 必須完全照抄我給你的句子，一個標點都不要改
3. explain 用繁體中文，30 秒內讀完，直接指出這句話裡這個字前後的線索，說明為什麼是這個用法
4. 每句都要有對應的輸出，不要漏

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "answers": [
    {"word": "字", "sentence": "原句", "senseId": "分類 id", "explain": "解說"}
  ]
}`
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
