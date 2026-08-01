// Google Cloud TTS 的語音分級與排序——純函式，方便單元測試
//
// 為什麼不在程式裡寫死一份音色清單：Google 持續在加新音色（Chirp 3 HD 尤其頻繁），
// 寫死的清單遲早過期，而且名字打錯一個字上游就回 400。改成跟 Worker 要
// voices.list 的結果，這裡只負責「拿到清單之後怎麼分級、怎麼排、怎麼顯示」。
//
// 這支跟 voiceScore.ts 是兩套東西：那支在猜「這台裝置上哪個瀏覽器語音比較不機械」，
// 全靠名字關鍵字；這支的分級來自 Google 官方的產品線名稱，是確定的事實。

import type { VoiceGender } from './voiceMeta'
import type { TaskLanguage } from './types'

/** voices.list 回傳的單一語音（只取用得到的欄位） */
export interface GoogleVoice {
  name: string
  languageCodes: string[]
  ssmlGender: string
}

/**
 * Google 的語音產品線，由新到舊。Chirp 3: HD 是目前最接近真人的一批。
 *
 * 刻意不收 Studio：它是 $160/1M 字元，是 Chirp 3 HD 的 5 倍多、Standard 的 40 倍，
 * 對自用家庭 App 完全不成比例，列在選單裡只會讓人不小心選到就開始燒錢。
 */
const TIERS = ['Chirp3-HD', 'Chirp-HD', 'Neural2', 'Polyglot', 'News', 'Casual', 'Wavenet', 'Standard'] as const

export type GoogleTier = (typeof TIERS)[number]

/** 分數只用來排序，絕對值沒有意義 */
const TIER_SCORE: Record<GoogleTier, number> = {
  'Chirp3-HD': 100,
  'Chirp-HD': 90,
  Neural2: 80,
  Polyglot: 70,
  News: 60,
  Casual: 55,
  Wavenet: 50,
  Standard: 10,
}

export const TIER_LABELS: Record<GoogleTier, string> = {
  'Chirp3-HD': '最自然',
  'Chirp-HD': '很自然',
  Neural2: '自然',
  Polyglot: '多語',
  News: '新聞播報',
  Casual: '口語',
  Wavenet: '一般',
  Standard: '基本',
}

/** 這些等級值得在 UI 上標「推薦」 */
export function isTopTier(tier: GoogleTier | null): boolean {
  return tier === 'Chirp3-HD' || tier === 'Chirp-HD'
}

/**
 * 從語音全名判斷產品線，例如：
 *   en-US-Chirp3-HD-Aoede → Chirp3-HD
 *   ja-JP-Neural2-B       → Neural2
 * 認不出來（Google 出了新產品線）回 null，UI 就不標等級，但語音本身照樣能用。
 */
export function tierOf(voiceName: string): GoogleTier | null {
  for (const tier of TIERS) {
    // Chirp3-HD 要排在 Chirp-HD 前面（TIERS 的順序已經保證），
    // 否則 en-US-Chirp3-HD-Aoede 會先被 Chirp-HD 比中
    if (voiceName.includes(`-${tier}-`)) return tier
  }
  return null
}

/**
 * 音色的短名，給 UI 顯示用：
 *   en-US-Chirp3-HD-Aoede → Aoede
 *   en-GB-Neural2-B       → B
 */
export function shortNameOf(voiceName: string): string {
  const parts = voiceName.split('-')
  return parts[parts.length - 1] || voiceName
}

/** Google 的 ssmlGender 是確定的欄位，不必像瀏覽器語音那樣猜名字 */
export function genderOfGoogleVoice(v: GoogleVoice): VoiceGender | null {
  if (v.ssmlGender === 'FEMALE') return 'female'
  if (v.ssmlGender === 'MALE') return 'male'
  return null
}

export function langCodeOf(v: GoogleVoice): string {
  return v.languageCodes[0] ?? v.name.split('-').slice(0, 2).join('-')
}

/** 查 voices.list 用的語系碼——用兩碼可一次拿到 en-US／en-GB／en-AU… 各種口音 */
export const GOOGLE_LANG_QUERY: Record<TaskLanguage, string> = {
  英文: 'en',
  日文: 'ja',
  韓文: 'ko',
}

/** 兩碼查不到東西時的退路，同時也是自動挑選時偏好的口音 */
export const GOOGLE_PRIMARY_LOCALE: Record<TaskLanguage, string> = {
  英文: 'en-US',
  日文: 'ja-JP',
  韓文: 'ko-KR',
}

/**
 * 依「自然度優先、主要口音次之」排序，好的在前；同分維持原順序，結果才穩定。
 * 這個排序的第一名就是使用者沒指定時的自動挑選結果。
 */
export function rankGoogleVoices(voices: GoogleVoice[], primaryLocale: string): GoogleVoice[] {
  return voices
    .map((v, i) => {
      const tier = tierOf(v.name)
      const tierScore = tier ? TIER_SCORE[tier] : 30 // 認不出的新產品線給中段分，不埋沒也不搶頭香
      const localeBonus = langCodeOf(v).toLowerCase() === primaryLocale.toLowerCase() ? 5 : 0
      return { v, i, s: tierScore + localeBonus }
    })
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.v)
}

/** 過濾掉不想出現在選單裡的語音（目前只有 Studio，理由見 TIERS 的註解） */
export function isSelectableVoice(v: GoogleVoice): boolean {
  return !v.name.includes('-Studio-') && !v.name.includes('-Journey-')
}
