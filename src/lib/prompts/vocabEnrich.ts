// 單字補完器：一次把整批新字補上音標、例句、搭配詞
// 混合模式的「AI」那一半——內建字表只給字與中文，語境由 AI 生成
// 內建字表用完時，也用同一支 prompt 直接生成新字

import type { VocabSeed } from '../../data/vocabLists'
import type { TaskLanguage } from '../types'

export interface VocabEnrichInput {
  language: TaskLanguage
  exam: string
  examLevel: string
  /** 要補完的字（來自內建字表）；留空表示請 AI 直接產生新字 */
  seeds: VocabSeed[]
  /** 需要幾個字（seeds 為空時使用） */
  count: number
  /** 已學過的字，避免重複 */
  known: string[]
}

export function vocabEnrichSystemPrompt(input: VocabEnrichInput): string {
  // 韓文寫的就是拼音文字，給 KK/IPA 音標沒有意義也沒人在用，
  // 韓語教材的慣例是給羅馬字轉寫（教育部式／文觀部式）
  const readingDesc =
    input.language === '日文'
      ? '假名讀音（平假名）'
      : input.language === '韓文'
        ? '羅馬字轉寫（文觀部式 Revised Romanization）'
        : 'KK 或 IPA 音標'

  const task =
    input.seeds.length > 0
      ? `請為以下指定單字補完學習資料，順序與數量必須完全一致（${input.seeds.length} 個）：
${input.seeds.map((s, i) => `${i + 1}. ${s.w}（${s.pos} ${s.zh}）`).join('\n')}`
      : `請產生 ${input.count} 個適合 ${input.exam} ${input.examLevel} 程度的高頻單字。`

  const avoid =
    input.known.length > 0
      ? `\n\n以下單字使用者已經學過，絕對不要再出現：${input.known.slice(0, 120).join('、')}`
      : ''

  return `你是${input.language}單字教材編寫者，服務對象為準備 ${input.exam} ${input.examLevel} 的台灣學習者。

${task}${avoid}

每個單字要給：
1. reading：${readingDesc}
2. meaning_zh：繁體中文字義。一詞多義時只給該考試最常考的 1-2 個，用「；」分隔
3. example：一個例句，長度 8-18 字，情境要貼近 ${input.exam} 的真實出題場景（不要教科書式的假句子）
4. example_zh：例句的繁體中文翻譯
5. collocations：2-3 個真實高頻搭配（如 make a decision、下決心を固める）。給搭配片語本身，不要給整句

硬性要求：
- example 必須包含該單字本身
- collocations 必須是母語者真的會這樣講的組合，寧可少給也不要湊數
- ${
    input.language === '日文'
      ? '例句標註丁寧體；動詞給辭書形'
      : input.language === '韓文'
        ? '例句用해요體；用言給기본형（-다 結尾）'
        : '例句用自然口語或商務書面語，依該考試情境決定'
  }

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "words": [
    {"word":"","reading":"","meaning_zh":"","pos":"","example":"","example_zh":"","collocations":["",""]}
  ]
}`
}

export interface EnrichedWord {
  word: string
  reading: string
  meaning_zh: string
  pos: string
  example: string
  example_zh: string
  collocations: string[]
}

export interface VocabEnrichResult {
  words: EnrichedWord[]
}

export function isVocabEnrichResult(v: unknown): v is VocabEnrichResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.words) || o.words.length === 0) return false
  return o.words.every((w) => {
    if (typeof w !== 'object' || w === null) return false
    const item = w as Record<string, unknown>
    if (typeof item.word !== 'string' || item.word.trim() === '') return false
    if (typeof item.meaning_zh !== 'string') return false
    // 其餘欄位缺漏時可補空字串，不因此判定失敗
    return true
  })
}

/** 把 AI 回傳的資料正規化，缺欄位補預設值 */
export function normalizeEnriched(w: EnrichedWord): EnrichedWord {
  return {
    word: String(w.word ?? '').trim(),
    reading: String(w.reading ?? '').trim(),
    meaning_zh: String(w.meaning_zh ?? '').trim(),
    pos: String(w.pos ?? '').trim(),
    example: String(w.example ?? '').trim(),
    example_zh: String(w.example_zh ?? '').trim(),
    collocations: Array.isArray(w.collocations)
      ? w.collocations.filter((c) => typeof c === 'string' && c.trim() !== '').slice(0, 4)
      : [],
  }
}
