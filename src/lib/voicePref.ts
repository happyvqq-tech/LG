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
