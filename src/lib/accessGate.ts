// 通關密碼的裝置端存取——純函式部分。
//
// 這不是帳號系統：全家共用同一組密碼，目的只是擋住網址外流後被陌生人
// 拿去打會花錢的 API（Anthropic、雅婷 TTS），不是要做誰是誰的登入。
// Worker 端才是真正的關卡（見 worker/src/index.ts 的 hasAccess）；
// 這裡存的密碼只是讓使用者不用每次開站都輸入一次。

const STORAGE_KEY = 'lgl.access'

export function loadAccessPassphrase(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v && v.trim() !== '' ? v : null
  } catch {
    // 無痕模式等 localStorage 不可用時，退回每次都要輸入
    return null
  }
}

export function saveAccessPassphrase(passphrase: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, passphrase)
  } catch {
    // 存不進去不影響本次已經解鎖的畫面，只是下次重整又要輸入一次
  }
}

export function clearAccessPassphrase(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 清不掉沒關係，反正接下來會被要求重新輸入正確的密碼
  }
}

export function hasStoredAccessPassphrase(): boolean {
  return loadAccessPassphrase() !== null
}
