// 古文教學 prompt：字詞註釋、白話翻譯批改、文意提問
//
// 翻譯批改採用語文教學的標準口訣「留、刪、補、換、調、變」六法：
//   留 專名照抄／刪 發語詞虛字／補 省略成分／換 古今詞義／調 語序／變 潤飾
// 批改時指出錯在哪一法，學習者才知道下次該注意什麼，而不是只被告知「翻錯了」。

/** 古文錯誤分類（進錯誤記憶庫用，比照英日文的固定分類表） */
export const CLASSICAL_ERROR_TYPES = [
  '虛詞誤解',
  '詞類活用未辨',
  '古今異義',
  '句式誤判',
  '通假未識',
  '漏譯',
  '增譯',
  '語序未調',
  '專名誤譯',
] as const

export type ClassicalErrorType = (typeof CLASSICAL_ERROR_TYPES)[number]

export interface AnnotateInput {
  title: string
  source: string
  /** 本次要處理的段落原文（含標點） */
  passage: string
  level: string
}

export interface AnnotateNote {
  word: string
  type: string
  explain: string
}

export interface AnnotateResult {
  notes: AnnotateNote[]
  translation: string
  questions: Array<{ q: string; hint: string }>
}

export function isAnnotateResult(v: unknown): v is AnnotateResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.translation !== 'string' || o.translation.trim() === '') return false
  if (!Array.isArray(o.notes)) return false
  if (!Array.isArray(o.questions)) o.questions = []
  return o.notes.every((n) => {
    if (typeof n !== 'object' || n === null) return false
    const item = n as Record<string, unknown>
    return typeof item.word === 'string' && typeof item.explain === 'string'
  })
}

export interface TranslationGradeInput {
  title: string
  passage: string
  userTranslation: string
  level: string
}

export interface TranslationIssue {
  original: string
  user: string
  correct: string
  method: string
  error_type: string
  note: string
}

export interface TranslationGradeResult {
  score: number
  reference: string
  issues: TranslationIssue[]
  praise: string
}

export function isTranslationGradeResult(v: unknown): v is TranslationGradeResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.reference !== 'string') return false
  if (typeof o.score !== 'number') o.score = 0
  if (!Array.isArray(o.issues)) return false
  if (typeof o.praise !== 'string') o.praise = ''
  return o.issues.every((i) => {
    if (typeof i !== 'object' || i === null) return false
    const item = i as Record<string, unknown>
    return typeof item.original === 'string' && typeof item.correct === 'string'
  })
}
