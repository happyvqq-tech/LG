// 聽力挖空聽寫——純函式，方便單元測試
//
// 參考希平方「聽打＋填空」的精聽練習法：先聽（可重播），再看到原文被挖掉幾個
// 關鍵字的版本，把聽到的字填回去。挖空對象直接來自任務本身真實的聽力稿，
// 不需要另外呼叫 AI 生成——零幻覺風險、零額外成本。
import type { Language } from './types'

export interface ClozeSegment {
  text: string
  isBlank: boolean
  /** isBlank 為 true 時，對應 answers 陣列的索引 */
  blankIndex?: number
}

export interface ClozeRound {
  segments: ClozeSegment[]
  /** 正解，依 blankIndex 排列 */
  answers: string[]
  /** 完整原文（作答後對照用） */
  sourceText: string
}

const EN_STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'in', 'on', 'at', 'for', 'with', 'and', 'or', 'but', 'nor',
  'it', 'its', 'this', 'that', 'these', 'those', 'he', 'she', 'they', 'we',
  'you', 'i', 'my', 'your', 'his', 'her', 'their', 'our', 'me', 'him', 'us',
  'them', 'not', 'no', 'do', 'does', 'did', 'done', 'have', 'has', 'had',
  'will', 'would', 'can', 'could', 'shall', 'should', 'may', 'might', 'must',
  'as', 'by', 'from', 'so', 'if', 'than', 'then', 'up', 'out', 'about',
  'into', 'over', 'after', 'before', 'just', 'very', 'also', 'there', 'here',
  'what', 'when', 'where', 'who', 'how', 'all', 'some', 'one',
])

function wordRegexFor(language: Language): RegExp {
  if (language === '日文') return /[一-鿿々]+/g
  // 韓文有分寫（띄어쓰기），但助詞是黏在詞後面的，所以整個諺文詞節一起挖，
  // 不要試著把助詞切開——切錯反而讓題目不成立
  if (language === '韓文') return /[가-힣]+/g
  return /[A-Za-z]+(?:'[A-Za-z]+)?/g
}

function isCandidate(word: string, language: Language): boolean {
  if (language === '日文') return word.length >= 2
  // 韓文一個音節就是一個字，兩音節以上才有挖空的意義
  if (language === '韓文') return word.length >= 2
  if (word.length < 4) return false
  return !EN_STOPWORDS.has(word.toLowerCase())
}

/** 從一段文字裡，挑最多 blankCount 個關鍵字挖空，均勻分布在全文（候選不足時全部挖光） */
export function buildClozeRound(passage: string, language: Language, blankCount: number): ClozeRound {
  const regex = wordRegexFor(language)
  const matches = [...passage.matchAll(regex)]
  const candidateIdxs = matches
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => isCandidate(m[0], language))
    .map(({ i }) => i)

  if (candidateIdxs.length === 0) {
    return { segments: [{ text: passage, isBlank: false }], answers: [], sourceText: passage }
  }

  const count = Math.min(blankCount, candidateIdxs.length)
  const chosen: number[] = []
  const chosenSet = new Set<number>()
  for (let i = 0; i < count; i++) {
    let pos = Math.min(Math.floor(((i + 0.5) * candidateIdxs.length) / count), candidateIdxs.length - 1)
    while (chosenSet.has(candidateIdxs[pos]) && pos + 1 < candidateIdxs.length) pos++
    if (!chosenSet.has(candidateIdxs[pos])) {
      chosenSet.add(candidateIdxs[pos])
      chosen.push(candidateIdxs[pos])
    }
  }
  chosen.sort((a, b) => a - b)

  const segments: ClozeSegment[] = []
  const answers: string[] = []
  let cursor = 0
  for (const idx of chosen) {
    const m = matches[idx]
    if (m.index === undefined) continue
    if (m.index > cursor) segments.push({ text: passage.slice(cursor, m.index), isBlank: false })
    segments.push({ text: m[0], isBlank: true, blankIndex: answers.length })
    answers.push(m[0])
    cursor = m.index + m[0].length
  }
  if (cursor < passage.length) segments.push({ text: passage.slice(cursor), isBlank: false })

  return { segments, answers, sourceText: passage }
}

/** 把聽力稿分成好幾輪練習：單句模式每句一輪，短段落模式每 2 句合成一輪 */
export function buildClozeSession(
  sentences: string[],
  language: Language,
  mode: 'sentence' | 'paragraph',
): ClozeRound[] {
  const passages =
    mode === 'sentence'
      ? sentences
      : Array.from({ length: Math.ceil(sentences.length / 2) }, (_, i) =>
          sentences.slice(i * 2, i * 2 + 2).join(' '),
        )
  const blankCount = mode === 'sentence' ? 2 : 4
  return passages
    .map((p) => buildClozeRound(p, language, blankCount))
    .filter((r) => r.answers.length > 0)
}
