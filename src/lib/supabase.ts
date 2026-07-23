import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // 缺環境變數時直接在 console 給出明確指示，避免各頁面各自報錯
  console.error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，請依 .env.example 建立 .env')
}

export const supabase = createClient(url ?? '', anonKey ?? '')
