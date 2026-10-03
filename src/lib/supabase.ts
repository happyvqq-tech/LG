import { createClient } from '@supabase/supabase-js'
import { loadAccessPassphrase } from './accessGate'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // 缺環境變數時給出明確指示；用占位值避免 createClient 直接 throw 導致整頁白屏
  console.error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，請依 .env.example 建立 .env')
}

/** 要跟 worker/src/index.ts 的 ACCESS_HEADER、lib/claude.ts、lib/googleTts.ts 一致 */
const ACCESS_HEADER = 'x-lgl-access'

/**
 * 每次請求才讀密碼，而不是在 createClient 時用 global.headers 帶一次。
 *
 * 原因：這個模組在 App 掛載時就被 import，那時使用者還沒輸入密碼
 * （AccessGate 才正要跳出來問）。用 global.headers 的話 client 會永遠帶著
 * 空密碼，除非解鎖後整頁重新整理。改成攔 fetch 就沒這個問題——解鎖之後
 * 下一個查詢自然就帶得到。
 *
 * 沒有設 RLS 密碼的資料庫收到這個 header 也不會怎樣，policy 根本不看它。
 */
function fetchWithAccess(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const passphrase = loadAccessPassphrase()
  if (!passphrase) return fetch(input, init)
  const headers = new Headers(init?.headers)
  headers.set(ACCESS_HEADER, passphrase)
  return fetch(input, { ...init, headers })
}

export const supabase = createClient(
  url || 'https://missing-env.supabase.co',
  anonKey || 'missing-anon-key',
  { global: { fetch: fetchWithAccess } },
)

/**
 * 把 supabase 的錯誤翻成看得懂、而且知道下一步要做什麼的中文。
 *
 * 為什麼需要這支：postgrest-js 在底層 fetch 整個失敗（請求根本沒送達）時，
 * 會把例外包成 `${name}: ${message}` 丟進 error.message，於是畫面上就出現
 * 「儲存失敗：TypeError: Load failed」——那是 Safari 對「這個 fetch 掛了」的
 * 說法，對使用者完全沒有資訊量，更糟的是它跟「伺服器收到了但拒絕」長得一模一樣，
 * 而這兩件事的處理方式完全相反（一個要去看資料庫活著沒，一個要去看欄位或權限）。
 *
 * 判斷依據用 status：請求沒送達時 postgrest 會給 status 0。
 * 另外比對訊息字樣當備援，因為三個瀏覽器的用詞都不一樣
 * （Safari「Load failed」、Chrome「Failed to fetch」、Firefox「NetworkError…」）。
 */
const NETWORK_HINTS = ['load failed', 'failed to fetch', 'networkerror', 'network request failed']

export function isNetworkFailure(error: { message?: string } | null, status?: number): boolean {
  if (status === 0) return true
  const m = (error?.message ?? '').toLowerCase()
  return NETWORK_HINTS.some((h) => m.includes(h))
}

export function describeSupabaseError(error: { message?: string } | null, status?: number): string {
  if (isNetworkFailure(error, status)) {
    return '連不上資料庫（請求沒送出去）。先確認網路，再到 Supabase 後台看看專案是不是被暫停了——免費方案閒置一段時間會自動暫停，按一下恢復就好。'
  }
  return error?.message ?? '未知錯誤'
}
