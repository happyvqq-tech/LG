// 從語音的 lang / name 推出「口音」與「男聲女聲」——純函式，方便單元測試
//
// Web Speech API 只給 name / lang / localService 三個欄位，沒有性別欄位。
// 口音可以直接從 lang 判斷（可靠）；性別只能從名字猜（名字對照表 + 名稱裡
// 明寫 Male/Female 的情況），猜不出來就回 null，UI 就不顯示標記，
// 不要用猜的去誤導使用者。

export interface AccentInfo {
  /** 用來分組與篩選的鍵，直接用正規化後的 lang */
  code: string
  label: string
}

/** lang → 口音中文標籤。查不到的用地區碼原樣顯示，不要瞎編。 */
const ACCENT_LABELS: Record<string, string> = {
  'en-us': '美式',
  'en-gb': '英式',
  'en-au': '澳洲',
  'en-in': '印度',
  'en-ca': '加拿大',
  'en-ie': '愛爾蘭',
  'en-nz': '紐西蘭',
  'en-za': '南非',
  'en-sg': '新加坡',
  'en-hk': '香港',
  'en-ph': '菲律賓',
  'ja-jp': '日本',
  'ko-kr': '韓國',
  'zh-tw': '台灣',
  'zh-cn': '中國',
  'zh-hk': '香港',
}

function normalizeLang(lang: string): string {
  return lang.replace('_', '-').toLowerCase()
}

export function accentOf(lang: string): AccentInfo {
  const code = normalizeLang(lang)
  const label = ACCENT_LABELS[code]
  if (label) return { code, label }
  // 查不到就顯示地區碼（例如 en-KE 顯示成 KE），至少讓使用者知道有差別
  const region = code.split('-')[1]
  return { code, label: region ? region.toUpperCase() : code }
}

export type VoiceGender = 'female' | 'male'

/**
 * 常見語音名字對照。來源是各平台實際出現過的語音：
 * Microsoft Edge Natural 系列、Apple（macOS/iOS）、Google TTS。
 * 只收有把握的，沒把握的一律不列——寧可不顯示標記也不要標錯。
 */
const FEMALE_NAMES = new Set([
  // Microsoft
  'aria', 'jenny', 'michelle', 'ana', 'ava', 'emma', 'sara', 'nancy', 'amber',
  'ashley', 'cora', 'elizabeth', 'monica', 'jane', 'nova', 'libby', 'sonia',
  'maisie', 'natasha', 'clara', 'molly', 'neerja', 'yasmin', 'zira', 'hazel',
  'heather', 'hedda', 'linda', 'denise', 'julie', 'paulina', 'laura', 'helena',
  'katja', 'hortense', 'susana', 'sabina', 'lucia', 'alice', 'elsa', 'isabela',
  'francisca', 'joana', 'luciana', 'ines', 'ingrid', 'camille', 'chantal',
  'amelie', 'marlene', 'seoyeon', 'mizuki', 'nanami', 'hiujin', 'xiaoxiao',
  'xiaoyi', 'hsiaochen', 'hsiaoyu',
  // Apple
  'samantha', 'karen', 'moira', 'tessa', 'fiona', 'victoria', 'allison',
  'susan', 'zoe', 'nicky', 'serena', 'kate', 'catherine', 'kyoko', 'meijia',
  'sinji', 'tingting', 'amira', 'anna', 'ellen', 'zosia', 'yuna',
  // Amazon/Google 常見
  'salli', 'kimberly', 'kendra', 'joanna', 'ivy', 'ruth', 'kajal', 'olivia',
  'freya', 'luna', 'mia', 'sophia', 'lily', 'wendy', 'vicki', 'aditi', 'raveena',
])

const MALE_NAMES = new Set([
  // Microsoft
  'guy', 'davis', 'tony', 'jason', 'andrew', 'brian', 'christopher', 'eric',
  'roger', 'steffan', 'ryan', 'thomas', 'alfie', 'elliot', 'ethan', 'liam',
  'william', 'prabhat', 'duncan', 'luke', 'mitchell', 'connor', 'david', 'mark',
  'george', 'james', 'richard', 'matthew', 'stefan', 'conrad', 'bernd',
  'yunxi', 'yunyang', 'yunjhe', 'yunye', 'keita', 'naoki', 'injoon',
  // Apple
  'alex', 'daniel', 'fred', 'tom', 'aaron', 'arthur', 'gordon', 'lee',
  'oliver', 'rishi', 'rocko', 'reed', 'otoya', 'hattori', 'liangliang',
  // Amazon/Google 常見
  'justin', 'joey', 'russell', 'geraint', 'giorgio', 'hans', 'yannick',
  'mathieu', 'nicolas', 'enrique', 'jorge', 'miguel', 'ricardo', 'felipe',
  'carlos', 'diego', 'joaquim', 'cristiano', 'maxim', 'ivan', 'takumi',
])

/** 從語音名稱判斷男女；判斷不出來回 null（UI 就不顯示標記） */
export function genderOf(name: string): VoiceGender | null {
  const lower = name.toLowerCase()

  // 有些語音名字直接寫了性別（例如 "Google UK English Female"），優先採信
  if (/\bfemale\b|\bwoman\b/.test(lower)) return 'female'
  if (/\bmale\b|\bman\b/.test(lower)) return 'male'

  // 名字通常長成 "Microsoft Aria Online (Natural) - English (United States)"
  // 或 "Samantha"，把可能的名字片段逐一比對對照表
  for (const token of lower.split(/[^a-z]+/)) {
    if (!token) continue
    if (FEMALE_NAMES.has(token)) return 'female'
    if (MALE_NAMES.has(token)) return 'male'
  }
  return null
}

export const GENDER_LABELS: Record<VoiceGender, string> = {
  female: '女聲',
  male: '男聲',
}
