// 每日測驗出題：針對已學過的字，出「全新情境」的填空題
//
// 關鍵設計：句子必須是新的，不能沿用單字卡上那句例句。
// 沿用的話測到的是「記不記得那句話」，不是「會不會用這個字」。

import type { TaskLanguage, VocabCard } from '../types'

export const BLANK = '___'

export interface QuizGenInput {
  language: TaskLanguage
  exam: string
  examLevel: string
  cards: VocabCard[]
}

export function quizGeneratorSystemPrompt(input: QuizGenInput): string {
  const list = input.cards
    .map((c, i) => {
      const known = c.example ? `（單字卡既有例句：${c.example}）` : ''
      return `${i + 1}. ${c.word}${c.reading ? `／${c.reading}` : ''}｜${c.pos} ${c.meaning_zh}${known}`
    })
    .join('\n')

  const isJa = input.language === '日文'

  return `你是${input.language}測驗命題老師，對象是準備 ${input.exam} ${input.examLevel} 的台灣學習者。

針對以下 ${input.cards.length} 個單字各出一題填空題，順序與數量必須完全一致：
${list}

命題規則（違反任一條即為不合格）：
1. 句子必須是**全新情境**。若上面附了既有例句，你出的句子在情境、主詞、場景上都要和它不同，不能只換幾個字
2. 挖空處一律寫成 ${BLANK}（三個底線），**整句只能有一個 ${BLANK}**
3. 句子裡**絕對不可以出現該單字本身**（含變化形），否則等於送分
4. 上下文要留足夠線索，讓懂這個字的人能推出答案；不要出成猜謎，也不要出成隨便填什麼都通
5. 難度貼近 ${input.exam} ${input.examLevel} 的實際出題，場景要真實
6. 每題附 hint：不透露答案，只點出「這裡要填的是什麼概念」（例如「表示『正式採用並執行』的動詞」）
7. ${isJa ? '句子用丁寧體；答案若為動詞請以辭書形為準' : '答案以原形為準；若句子文法上需要變化形，請調整句子讓原形能直接填入'}

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "questions": [
    {"word":"對應的單字","sentence":"含一個 ${BLANK} 的句子","sentence_zh":"整句中文翻譯","hint":"不透露答案的提示"}
  ]
}`
}

export interface QuizQuestionRaw {
  word: string
  sentence: string
  sentence_zh: string
  hint: string
}

export interface QuizGenResult {
  questions: QuizQuestionRaw[]
}

export function isQuizGenResult(v: unknown): v is QuizGenResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.questions) || o.questions.length === 0) return false
  return o.questions.every((q) => {
    if (typeof q !== 'object' || q === null) return false
    const item = q as Record<string, unknown>
    return typeof item.word === 'string' && typeof item.sentence === 'string'
  })
}

/**
 * 修掉 AI 可能犯的兩個錯：句子沒有空格、或句子裡直接寫出答案。
 * 回傳 null 代表這題無法補救，呼叫端應丟棄。
 */
export function sanitizeSentence(sentence: string, word: string): string | null {
  let s = String(sentence ?? '').trim()
  if (s === '') return null

  // 統一各種底線寫法為標準空格標記
  s = s.replace(/_{2,}|＿{2,}/g, BLANK)

  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // 答案外洩時就地挖空（連同常見變化形字尾一起吃掉）
  const leak = new RegExp(`\\b${escaped}(s|es|ed|ing|d)?\\b`, 'gi')
  if (leak.test(s)) s = s.replace(leak, BLANK)
  // 非英數語言沒有 \b 可用，直接比對字面
  if (s.includes(word)) s = s.split(word).join(BLANK)

  const blanks = s.split(BLANK).length - 1
  if (blanks === 0) return null
  // 多個空格時只留第一個，其餘還原不了就丟棄
  if (blanks > 1) return null

  return s
}
