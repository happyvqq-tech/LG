// 任務生成器 system prompt（CLAUDE.md 6.1，變數以模板注入）

import { JP_REGISTER_BY_SCENE } from './japaneseRegister'
import type { ErrorRecord, GrammarPoint, Level, TaskLanguage } from './types'

export interface TaskGeneratorInput {
  language: TaskLanguage
  level: Level
  scenario: string
  grammarPoints: GrammarPoint[]
  pendingErrors: ErrorRecord[]
  /**
   * 還在 active 的近期錯誤，本次任務要刻意製造「用得到這個句型」的情境。
   *
   * 為什麼需要：狀態機原本只要「這次任務沒再犯」就累計一次，但沒再犯很可能
   * 只是任務根本沒用到那個句型。沒有製造機會就不算數，否則會累積出一堆
   * 假陽性的 resolved——學習者以為攻克了，系統也不再考他，那個錯誤就永久逃逸。
   */
  exposureErrors?: ErrorRecord[]
  /** 單字庫中學習中的字，讓任務自然用到（學了馬上碰到） */
  vocabWords?: string[]
}

/**
 * 「語塊」在三個語言裡根本不是同一種東西，用同一套說法會生出學了也組不出句子的碎片。
 *
 * 英文的可套用單位是詞彙層的搭配；日文與韓文則是文法化的形式——
 * 日文靠文型、韓文靠語尾與慣用句型，那才是他們「整組背起來就能用」的東西。
 */
const CHUNK_GUIDE: Record<TaskLanguage, string> = {
  英文:
    '搭配詞（collocation）與片語動詞這類「整組一起用」的東西，例如 take ... into account、look forward to、be supposed to。不要給單字，也不要給完整句子',
  日文:
    '文型與慣用表現，例如 〜ばかりでなく、〜わけにはいかない、〜ざるを得ない、〜に違いない。日文的「可整段套用單位」是文法化的形式，不是詞彙搭配，所以不要給單字或單純的名詞片語',
  韓文:
    '連結語尾與慣用句型，例如 -는 바람에、-기 마련이다、-(으)ㄹ 뿐만 아니라、-다가 보니。韓文的「可整段套用單位」是語尾與慣用表現，不是詞彙搭配，所以不要給單字',
}

export function taskGeneratorSystemPrompt(input: TaskGeneratorInput): string {
  const grammarList = input.grammarPoints
    .map((g) => `${g.name}（${g.level}）：${g.description}`)
    .join('；')
  const errorList =
    input.pendingErrors.length > 0
      ? input.pendingErrors
          .map((e) => `「${e.original}」應為「${e.corrected}」（${e.error_type}）`)
          .join('；')
      : '無'

  const exposure = input.exposureErrors ?? []
  const exposureList =
    exposure.length > 0
      ? exposure
          .map((e) => `「${e.original}」應為「${e.corrected}」（${e.error_type}）`)
          .join('；')
      : '無'

  const vocabList =
    input.vocabWords && input.vocabWords.length > 0 ? input.vocabWords.join('、') : '無'

  return `你是語言學習任務設計師。根據以下輸入生成一個 8-15 分鐘的任務式學習循環。

輸入變數：
- 語言：${input.language}
- 程度：${input.level}
- 情境類別：${input.scenario}
- 本週文法點：${grammarList}
- 待驗證錯誤：${errorList}
- 近期錯誤（要製造使用機會）：${exposureList}
- 複習中的單字：${vocabList}

硬性要求：
0. 程度為 A2（初級）時：聽力稿縮短為 100-150 字、句子放短、只用常見高頻字，語塊改為 4-6 個；B1 以上依下列原則
1. 聽力稿 150-250 字，口語自然，必須自然融入指定文法點至少 3 次
2. 若有待驗證錯誤，必須在對話任務或寫作題中刻意設計會用到該句型的情境（不明說）
2-1. 若有「近期錯誤」，同樣要讓寫作題或對話任務**非用到該句型不可**——不是提醒他別犯錯，
     而是把情境設計成不用那個句型就講不完整。一樣不明說、不提示，讓他自然地用或自然地犯
3. 語塊（chunks）給 5-8 個。${input.language}的語塊指的是：${CHUNK_GUIDE[input.language]}
4. 寫作題必須與情境直接相關，30-80 字即可完成
5. ${input.language === '日文' ? JP_REGISTER_BY_SCENE : '（本語言無語體切換要求）'}
6. 若有「複習中的單字」，聽力稿要自然帶入其中 2-4 個（用不上的不要硬塞，也不要另外標註）

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "scenario_title": "",
  "scenario_desc": "",
  "listening_script": "",
  "chunks": [{"text": "", "zh": "", "usage": ""}],
  "speaking_goal": "",
  "speaking_role_setup": "AI 扮演的角色與立場",
  "writing_prompt": "",
  "grammar_points_used": []
}`
}
