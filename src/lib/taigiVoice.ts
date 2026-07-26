// 台語語音的可選音色（雅婷 TTS）——純資料與純函式，方便單元測試
//
// 瀏覽器的 speechSynthesis 沒有台語語音，台語的發音來源改用雅婷 TTS
// （CLAUDE.md 第 10 節的付費語音例外，使用者已明確同意）。
// 呼叫一律經過 Worker，金鑰不進前端。

export type TaigiVoiceId = 'tai_female_1' | 'tai_female_2' | 'tai_male_1'

export interface TaigiVoiceOption {
  id: TaigiVoiceId
  label: string
  gender: '女聲' | '男聲'
}

/** 雅婷目前提供的三個台語音色。model 字串要跟 Worker 白名單一致。 */
export const TAIGI_VOICES: TaigiVoiceOption[] = [
  { id: 'tai_female_1', label: '雅婷', gender: '女聲' },
  { id: 'tai_female_2', label: '意晴', gender: '女聲' },
  { id: 'tai_male_1', label: '家豪', gender: '男聲' },
]

export const DEFAULT_TAIGI_VOICE: TaigiVoiceId = 'tai_female_1'

export function isTaigiVoiceId(v: string): v is TaigiVoiceId {
  return TAIGI_VOICES.some((o) => o.id === v)
}

/**
 * 雅婷只吃 0.5~1.5 的 speed，站上的語速選單卻有 2.0 這一檔
 * （speechRate.ts）。直接送 2 上游會回 400，所以在這裡先夾住。
 * 夾到上限時 UI 要說明「台語最快只到 1.5 倍」，不要讓使用者以為壞了。
 */
export const TAIGI_MIN_SPEED = 0.5
export const TAIGI_MAX_SPEED = 1.5

export function clampTaigiSpeed(rate: number): number {
  if (!Number.isFinite(rate)) return 1
  const clamped = Math.min(TAIGI_MAX_SPEED, Math.max(TAIGI_MIN_SPEED, rate))
  // 留兩位小數（不是一位）：站上有 1.25 這一檔，只留一位會被進位成 1.3，
  // 使用者選 1.25 卻聽到 1.3 倍速。Worker 的快取鍵也要用同樣的位數才對得起來。
  return Math.round(clamped * 100) / 100
}

/** 這個語速有沒有被台語的上限夾掉（UI 據此顯示提示） */
export function isTaigiSpeedClamped(rate: number): boolean {
  if (!Number.isFinite(rate)) return true
  return clampTaigiSpeed(rate) !== Math.round(rate * 100) / 100
}

const VOICE_PREF_KEY = 'lgl.taigi.voice'

/** 台語音色偏好存在裝置上（跟 voicePref.ts 一樣，是裝置層設定不是成員設定） */
export function loadTaigiVoice(): TaigiVoiceId {
  try {
    const saved = localStorage.getItem(VOICE_PREF_KEY)
    if (saved && isTaigiVoiceId(saved)) return saved
  } catch {
    // localStorage 被隱私模式擋掉時就用預設值
  }
  return DEFAULT_TAIGI_VOICE
}

export function saveTaigiVoice(id: TaigiVoiceId): void {
  try {
    localStorage.setItem(VOICE_PREF_KEY, id)
  } catch {
    // 存不進去不影響本次使用
  }
}
