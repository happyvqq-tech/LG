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

const LEVEL_RULE: Record<TaigiLevel, string> = {
  入門: '每句 5-10 個字，只用最高頻的日常詞彙，不用俗諺',
  日常: '每句 8-16 個字，可用常見語尾詞（啦、喔、neh、hooh）',
  進階: '每句 12-22 個字，可用 1-2 句俗諺或較道地的講法',
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

export function taigiScriptSystemPrompt(input: TaigiScriptInput): string {
  return `你是台語（台灣閩南語）教材編寫者，為台灣家庭設計「聽」與「說」的練習腳本。

輸入：
- 情境：${input.topic}
- 難度：${input.level}（${LEVEL_RULE[input.level]}）

硬性要求：
1. 產出 6-10 句的自然對話或短講，口語，不要書面語腔
2. 每一句都要三行對照：
   - hanji：台文漢字，用教育部《臺灣閩南語推薦用字》（例如「這馬」不寫「現在」、「佇」不寫「在」、「毋」不寫「不」）
   - tailo：教育部臺灣閩南語羅馬字拼音（台羅），要標聲調數字或調符，音節之間用連字號連接（例如 tsit-má、tī、m̄）
   - mandarin：華語翻譯，繁體中文，意思要到位不要逐字硬翻
3. hanji 與 tailo 必須逐字對應，同一句不可以一邊多字一邊少字
4. 一句就是一句，不要在單一句裡塞多個句號
5. title 用華語寫，8 字以內，讓人一看就知道情境
6. notes 給 3-5 個這段腳本裡值得記住的台語詞或講法，每個都要 word（漢字）、tailo、zh（華語意思）

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "title": "",
  "lines": [{"hanji": "", "tailo": "", "mandarin": ""}],
  "notes": [{"word": "", "tailo": "", "zh": ""}]
}`
}

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
