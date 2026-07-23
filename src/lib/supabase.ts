import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // 缺環境變數時給出明確指示；用占位值避免 createClient 直接 throw 導致整頁白屏
  console.error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，請依 .env.example 建立 .env')
}

export const supabase = createClient(
  url || 'https://missing-env.supabase.co',
  anonKey || 'missing-anon-key',
)
