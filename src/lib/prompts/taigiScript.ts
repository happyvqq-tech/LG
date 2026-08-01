// 台語腳本生成器 system prompt。
//
// 台語模組只做「聽」與「說」（CLAUDE.md 第 1 節），所以這裡不生成
// 寫作題與閱讀題，只要一段可以逐句聽、逐句跟讀的自然對話或短講。
//
// 三行對照是台語教材的標準做法：
//   漢字（台文漢字，教育部推薦用字）／台羅（教育部台灣閩南語羅馬字）／華語翻譯
// 使用者可能三種都看得懂、也可能只看得懂華語，三行都給讓每個人自己取用。

import type { TaiwaneseScriptLine } from '../types'

export interface TaigiScriptInput {
  /** 情境，例如「菜市仔買菜」 */
  topic: string
  /** 難度：入門／日常／進階 */
  level: TaigiLevel
}

export type TaigiLevel = '入門' | '日常' | '進階'

export const TAIGI_LEVELS: TaigiLevel[] = ['入門', '日常', '進階']

export const TAIGI_LEVEL_DESC: Record<TaigiLevel, string> = {
  入門: '單句為主，用詞是最常聽到的那些，句子短好跟讀',
  日常: '一般家庭對話的長度與語速，會出現常用的語尾詞',
  進階: '句子較長，會用到俗諺與比較道地的講法',
}

export const TAIGI_TOPICS = [
  '菜市仔買菜',
  '和阿公阿媽開講',
  '去廟裡拜拜',
  '辦桌吃喜酒',
  '看醫生',
  '坐公車問路',
  '在灶跤煮食',
  '田裡的工課',
  '小吃攤點餐',
  '厝內的日常',
] as const

export interface TaigiNote {
  word: string
  tailo: string
  zh: string
}

export interface TaigiScriptJson {
  title: string
  lines: TaiwaneseScriptLine[]
  notes: TaigiNote[]
}

function isLine(v: unknown): v is TaiwaneseScriptLine {
  const l = v as TaiwaneseScriptLine
  return (
    !!l &&
    typeof l.hanji === 'string' &&
    l.hanji.trim().length > 0 &&
    typeof l.tailo === 'string' &&
    typeof l.mandarin === 'string'
  )
}

function isNote(v: unknown): v is TaigiNote {
  const n = v as TaigiNote
  return !!n && typeof n.word === 'string' && typeof n.tailo === 'string' && typeof n.zh === 'string'
}

export function isTaigiScriptJson(v: unknown): v is TaigiScriptJson {
  const s = v as TaigiScriptJson
  return (
    !!s &&
    typeof s.title === 'string' &&
    s.title.trim().length > 0 &&
    Array.isArray(s.lines) &&
    s.lines.length > 0 &&
    s.lines.every(isLine) &&
    Array.isArray(s.notes) &&
    s.notes.every(isNote)
  )
}
