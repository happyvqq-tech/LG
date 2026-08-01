// Prompt 組裝需要的型別——只定義 prompt 真的會讀到的欄位。
//
// 這裡刻意不共用前端的 src/lib/types.ts：那份是給 UI 與資料層用的完整模型，
// Worker 只需要「拿來填進模板的那幾個欄位」。定義成最小集合有兩個好處：
//   1. 前端的型別怎麼演進都不會意外弄壞 Worker
//   2. 一眼看得出 prompt 到底吃了哪些資料
//
// 這些資料是從瀏覽器送過來的，本質上不可信。但這裡的用途只有一個——
// 填進字串模板送給 Claude。填進去的東西再怪也只是產生一份怪 prompt，
// 不會有注入或越權問題，所以不做逐欄驗證（真正的關卡是通關密碼與限流）。

export type TaskLanguage = '英文' | '日文' | '韓文'
export type Language = TaskLanguage | '台語' | '古文'
export type Level = 'A2' | 'B1' | 'B2' | 'C1'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** errors 表的一列，prompt 只用得到這幾個欄位 */
export interface ErrorRecord {
  original: string
  corrected: string
  error_type: string
  rule_note: string
  status: string
}

export interface GrammarPoint {
  name: string
  level: string
  description: string
}

export interface DrillQuestion {
  q: string
  options: string[]
  answer: string
  explain: string
}

export interface GraderError {
  original: string
  corrected: string
  error_type: string
  rule_note: string
  drill: DrillQuestion[]
}

export interface VocabCard {
  word: string
  reading: string
  meaning_zh: string
  pos: string
  example: string
}

/** 內建字表的一筆（對應前端 data/vocabLists.ts） */
export interface VocabSeed {
  w: string
  zh: string
  pos: string
}

/** 古文虛詞的一種用法 */
export interface ParticleSense {
  id: string
  label: string
  desc: string
}

/** 古文虛詞（對應前端 data/classicalParticles.ts） */
export interface ParticleEntry {
  word: string
  senses: ParticleSense[]
}

export interface TaiwaneseScriptLine {
  hanji: string
  tailo: string
  mandarin: string
}
