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

/** 字詞註釋 + 白話翻譯 + 文意提問 */
export function annotateSystemPrompt(input: AnnotateInput): string {
  return `你是中文系的文言文教師，學生是台灣的${input.level}程度學習者。

篇名：《${input.title}》（${input.source}）
本段原文：
${input.passage}

請完成三件事：

一、挑出本段最該講的 5-8 個字詞（notes）。優先順序：
   1. 古今異義（今天看似懂、其實會誤解的字，如「妻子」「走」「湯」「去」）
   2. 詞類活用（名詞作動詞、使動、意動等）
   3. 關鍵虛詞（之、其、以、而、於、則、乃、者、也…）在此處的確切用法
   4. 通假字
   5. 生僻實詞
   每則寫明：word（原文用字）、type（從「古今異義／詞類活用／虛詞／通假字／實詞／專名」擇一）、
   explain（繁體中文，一兩句話講完，要說「在這裡是什麼意思」而不是列出所有義項）

二、translation：整段的白話翻譯。以直譯為主，語意不順處才意譯，不要加油添醋。

三、questions：2-3 個文意理解問題，問「為什麼」「言外之意」「作者的態度」，
   不要問可以直接抄原文回答的問題。每題附 hint（思考方向，不給答案）。

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "notes": [{"word":"","type":"","explain":""}],
  "translation": "",
  "questions": [{"q":"","hint":""}]
}`
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

/** 依六法批改學習者的白話翻譯 */
export function translationGraderSystemPrompt(input: TranslationGradeInput): string {
  return `你是嚴謹的文言文翻譯批改老師，學生是台灣的${input.level}程度學習者。

篇名：《${input.title}》
原文：
${input.passage}

學生的白話翻譯：
${input.userTranslation}

用「留、刪、補、換、調、變」六法檢查：
- 留：人名、地名、官名、年號、朝代等專名應照抄，不該硬翻
- 刪：發語詞（夫、蓋）、湊音節的助詞（之）、句末語氣詞該刪則刪
- 補：文言好省略，主語、賓語、介詞、量詞要補回來
- 換：古義換今義（走→跑、妻子→妻子兒女、湯→熱水、去→離開）
- 調：賓語前置、定語後置、狀語後置要調回現代語序（「何陋之有」→「有什麼簡陋的」）
- 變：最後潤飾成通順的現代中文

批改原則：
1. 只列真正的錯誤與遺漏，不吹毛求疵；純風格差異放進 reference 而非 issues
2. error_type 必須從此表擇一：虛詞誤解／詞類活用未辨／古今異義／句式誤判／通假未識／漏譯／增譯／語序未調／專名誤譯
3. method 標出違反的是六法中哪一法：留／刪／補／換／調／變
4. score 是 0-100 的整數，看「意思有沒有到位」而非文采
5. praise 要具體，指出他哪一處翻得準（例如某個虛詞或活用有看出來），不要空泛稱讚

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "score": 0,
  "reference": "參考譯文（直譯為主）",
  "issues": [{
    "original": "原文片段",
    "user": "學生譯法",
    "correct": "正確譯法",
    "method": "留|刪|補|換|調|變",
    "error_type": "從分類表擇一",
    "note": "為什麼，30 秒讀完"
  }],
  "praise": ""
}`
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
