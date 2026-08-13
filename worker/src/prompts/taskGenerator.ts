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
  /**
   * 成員自己填的興趣與近況（追的劇、工作領域、計畫中的旅行、嗜好）。
   *
   * 成人學習者對「跟自己有關的材料」的投入度遠高於通用教材，這是語言教學裡
   * 少數沒有爭議的結論。而 AI 生成最大的優勢正是無限個人化——同樣是「旅遊」
   * 情境，知道他下個月要去大阪，就能生成真的用得上的內容。
   */
  interests?: string
  /** 這次是「意料之外」的情境（吵架、客訴、急診…），語氣要有摩擦感 */
  surprise?: boolean
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

  const interests = input.interests?.trim()

  return `你是語言學習任務設計師。根據以下輸入生成一個 8-15 分鐘的任務式學習循環。

輸入變數：
- 語言：${input.language}
- 程度：${input.level}
- 情境類別：${input.scenario}
- 本週文法點：${grammarList}
- 待驗證錯誤：${errorList}
- 近期錯誤（要製造使用機會）：${exposureList}
- 複習中的單字：${vocabList}
- 學習者的興趣與近況：${interests && interests.length > 0 ? interests : '未提供'}

最高原則（優先於下面所有硬性要求）：
聽力稿必須是**一段連貫的文章**——同一個場景、同一條敘事線，句與句之間要有
因果、時間或轉折的銜接，讀起來像母語者寫給母語者的真實文本，而不是為了
展示文法而拼湊的例句集。寫完後自我檢查：任選相鄰兩句，若看不出它們為什麼
接在一起，就重寫。所有融入要求（文法點、單字、錯誤句型）都以不破壞連貫為
前提——塞不進去的就少塞，寧可自然流暢也不要硬湊。

硬性要求：
0. 程度為 A2（初級）時：聽力稿縮短為 100-150 字、句子放短、只用常見高頻字，語塊改為 4-6 個；B1 以上依下列原則
1. 聽力稿 150-250 字，口語自然，指定文法點以自然融入 3 次為目標；若硬塞第 3 次會破壞連貫，融入 2 次即可
2. 若有待驗證錯誤，必須在對話任務或寫作題中刻意設計會用到該句型的情境（不明說）
2-1. 若有「近期錯誤」，同樣要讓寫作題或對話任務**非用到該句型不可**——不是提醒他別犯錯，
     而是把情境設計成不用那個句型就講不完整。一樣不明說、不提示，讓他自然地用或自然地犯
3. 語塊（chunks）給 5-8 個。${input.language}的語塊指的是：${CHUNK_GUIDE[input.language]}
4. 寫作題必須與情境直接相關，30-80 字即可完成
5. ${input.language === '日文' ? JP_REGISTER_BY_SCENE : '（本語言無語體切換要求）'}
6. 若有「複習中的單字」，聽力稿要自然帶入其中 2-4 個（用不上的不要硬塞，也不要另外標註）
7. 若有「興趣與近況」，把情境長在那件事上面——不是提到它，是讓它成為情境的前提。
   例如「下個月要去大阪」就生成大阪旅館 check-in、車站問路；「在做軟體業」就讓
   職場情境是站立會議或需求討論。跟這次的情境類別搭不起來的部分就不要勉強用，
   個人化的目的是讓內容跟他有關，不是把他的資料全部塞進去${
     input.surprise
       ? `
8. 這次是「意料之外」的情境，不是順利的日常對話。要有真實的社交摩擦——
   對方會推託、會堅持、會有情緒，使用者得協商、拒絕、道歉或堅持立場才能推進。
   真實的語言能力從來不是在順利的場合被考驗的：會點餐不代表能處理送錯餐。
   但不要寫成戲劇化的衝突，維持成人之間有禮貌但立場不同的張力`
       : ''
  }

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
