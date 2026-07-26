// 測驗答案判定——純函式，方便單元測試
//
// 設計原則：寬容到剛剛好。打錯一個字母就判死會讓測驗變成打字比賽，
// 但完全不同的字當然要算錯。中間地帶（拼字接近、時態變形）給部分分數並指出正確寫法。

export type Verdict = 'correct' | 'inflected' | 'close' | 'wrong'

export const VERDICT_SCORE: Record<Verdict, number> = {
  correct: 1,
  inflected: 1,
  close: 0.5,
  wrong: 0,
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  correct: '答對',
  inflected: '答對（變化形）',
  close: '差一點',
  wrong: '答錯',
}

export function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = curr
  }
  return prev[b.length]
}

/**
 * 列出一個英文字所有可能的原形。
 * 用候選集合相交來判斷變化形，比取單一字幹準：
 * consequences 去 es 得 consequenc，但去 s 才對得上 consequence。
 */
function baseForms(w: string): Set<string> {
  const out = new Set<string>([w])
  if (w.length <= 3) return out

  const add = (s: string) => {
    if (s.length >= 3) out.add(s)
  }

  if (w.endsWith('ies')) add(w.slice(0, -3) + 'y')
  if (w.endsWith('ied')) add(w.slice(0, -3) + 'y')
  if (w.endsWith('ing')) {
    add(w.slice(0, -3))
    add(w.slice(0, -3) + 'e') // making → make
  }
  if (w.endsWith('ed')) {
    add(w.slice(0, -2))
    add(w.slice(0, -1)) // used → use
  }
  if (w.endsWith('es')) add(w.slice(0, -2))
  if (w.endsWith('s')) add(w.slice(0, -1))

  // 重複子音：stopped → stop、running → run
  for (const form of [...out]) {
    const dedup = form.replace(/([bcdfglmnprstz])\1$/, '$1')
    if (dedup !== form) add(dedup)
  }
  return out
}

/** 兩字的原形候選有交集，且原本不同 → 視為變化形 */
function isInflection(a: string, b: string): boolean {
  if (a === b) return false
  const fa = baseForms(a)
  for (const f of baseForms(b)) {
    if (fa.has(f)) return true
  }
  return false
}

/** 平假名/片假名/中日漢字/諺文——這些語言換一個字就可能是完全不同的詞 */
function hasCJK(s: string): boolean {
  return /[぀-ヿ㐀-䶿一-鿿가-힣]/.test(s)
}

/**
 * 拼字接近的判定。
 * 除了編輯距離，還要求首字相同——打字失誤很少發生在第一個字母，
 * 首字不同通常代表根本是另一個字（obtain vs contain 距離只有 2）。
 */
function isCloseSpelling(got: string, want: string): boolean {
  if (got[0] !== want[0]) return false
  const allowed = want.length <= 6 ? 1 : 2
  return levenshtein(got, want) <= allowed
}

/**
 * 判定作答。
 * @param input 使用者輸入
 * @param answer 正確答案（單字本體，或句子實際要填入的活用形）
 * @param reading 日文假名讀音；打假名也算對。韓文現在傳的是羅馬字轉寫，
 *   那是給人看的音標不是另一種可以拿來核對的書寫系統，下面刻意不對韓文套用
 */
export function judgeAnswer(input: string, answer: string, reading = ''): Verdict {
  const got = normalize(input)
  const want = normalize(answer)
  if (got === '') return 'wrong'
  if (got === want) return 'correct'

  // 打假名也算對——只對日文成立。韓文的 want 是諺文，reading 卻是羅馬字，
  // 兩種完全不同的書寫系統，套用這條反而會把正確答案判錯
  const isHangulAnswer = /[가-힣]/.test(want)
  const kana = normalize(reading)
  if (!isHangulAnswer && kana !== '' && got === kana) return 'correct'

  // 日文/韓文/中文換一個字就可能是完全不同的詞，判定要比英文嚴格：
  // 只有 4 字以上、且只差一個字、首字相同時才算「差一點」
  if (hasCJK(want) || hasCJK(got)) {
    // 使用者打假名時就跟假名比，打漢字就跟漢字比——這個切換只對日文有意義
    const isKanaInput = !isHangulAnswer && kana !== '' && !/[㐀-䶿一-鿿]/.test(got)
    const target = isKanaInput ? kana : want
    if (target.length >= 4 && got[0] === target[0] && levenshtein(got, target) === 1) {
      return 'close'
    }
    return 'wrong'
  }

  if (isInflection(got, want)) return 'inflected'
  return isCloseSpelling(got, want) ? 'close' : 'wrong'
}

/** 用了提示的題目最多給半分 */
export function scoreFor(verdict: Verdict, usedHint: boolean): number {
  const base = VERDICT_SCORE[verdict]
  return usedHint ? Math.min(base, 0.5) : base
}
