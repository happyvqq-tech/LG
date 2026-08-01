// 使用者手動指定的語音，依語言分開記
//
// 自動挑選（voiceScore.ts）只能靠名字與 localService 猜，猜不準的裝置一定有。
// 讓使用者自己試聽挑一個，是唯一保證能解決「聽起來像機器人」的作法。
//
// 刻意不依成員區分：裝置上裝了哪些語音、哪個聽起來自然，是這台機器的事實，
// 全家人共用同一台手機時答案是一樣的（語速才是因人而異，那個有分成員）。
// 存 voiceURI 而不是 name：同名不同語系的語音在某些平台上會撞在一起。

import type { Language } from './types'

const KEY_PREFIX = 'lgl.voice'

/**
 * Google 語音的偏好值前綴。
 *
 * 裝置語音存的是 voiceURI、Google 語音存的是音色全名（en-US-Chirp3-HD-Aoede），
 * 兩者格式撞不到但語意完全不同，加前綴才能明確區分「這個人選的是雲端語音
 * 還是這台機器上的語音」，而不是靠猜字串長相。
 */
const GOOGLE_PREFIX = 'google:'

function keyFor(language: Language): string {
  return `${KEY_PREFIX}.${language}`
}

/** 讀取偏好的 voiceURI；沒設定過回 null，代表交給自動挑選 */
export function loadVoicePref(language: Language): string | null {
  try {
    return localStorage.getItem(keyFor(language))
  } catch {
    // localStorage 不可用（無痕模式等）時退回自動挑選
    return null
  }
}

export function saveVoicePref(language: Language, voiceURI: string): void {
  try {
    localStorage.setItem(keyFor(language), voiceURI)
  } catch {
    // 存不起來就只在本次有效，不影響使用
  }
}

/** 清掉偏好，改回自動挑選 */
export function clearVoicePref(language: Language): void {
  try {
    localStorage.removeItem(keyFor(language))
  } catch {
    // 同上
  }
}

/** 使用者挑的是哪一種語音；沒設定過回 null，代表交給自動挑選 */
export type VoiceChoice =
  | { kind: 'google'; name: string }
  | { kind: 'device'; voiceURI: string }

export function loadVoiceChoice(language: Language): VoiceChoice | null {
  const raw = loadVoicePref(language)
  if (!raw) return null
  if (raw.startsWith(GOOGLE_PREFIX)) {
    const name = raw.slice(GOOGLE_PREFIX.length)
    return name ? { kind: 'google', name } : null
  }
  return { kind: 'device', voiceURI: raw }
}

export function saveGoogleVoicePref(language: Language, voiceName: string): void {
  saveVoicePref(language, `${GOOGLE_PREFIX}${voiceName}`)
}
