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
