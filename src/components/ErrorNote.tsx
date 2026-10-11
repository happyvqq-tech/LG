// 錯誤訊息：白話在上，技術細節收在下面
//
// 為什麼需要這個：ClaudeError 刻意把「給使用者看的白話」與「給開發者看的
// 狀態碼與上游字串」分開（稽核報告 P2-1：不要把原始 API 錯誤丟到家人眼前）。
// 方向是對的，但實際發生問題時畫面上只剩「AI 服務暫時發生問題，請稍後再試」——
// 那句話對任何人都沒有用，連要往哪裡查都不知道。
//
// 折衷：白話照舊擺在最上面，技術細節收進一個要主動點開的小連結。
// 平常看不到，要查的時候一秒就挖得出來。
import { useState } from 'react'
import { ClaudeError } from '../lib/claude'

export default function ErrorNote({ error, className = '' }: { error: unknown; className?: string }) {
  const [open, setOpen] = useState(false)

  const isClaude = error instanceof ClaudeError
  const friendly = isClaude ? error.friendlyMessage : String((error as Error)?.message ?? error)
  // 兩者相同時就沒有「細節」可言，不要給一個點開來看到一樣內容的連結
  const detail = isClaude && error.message !== error.friendlyMessage ? error.message : ''

  return (
    <div className={`rounded-xl bg-red-50 p-4 text-red-600 ${className}`}>
      <p>{friendly}</p>
      {detail && (
        <>
          <button
            onClick={() => setOpen((v) => !v)}
            className="mt-1 text-xs font-semibold text-red-500 underline underline-offset-2"
          >
            {open ? '收起技術細節' : '顯示技術細節'}
          </button>
          {open && (
            <p className="mt-1.5 break-words rounded-lg bg-red-100/70 p-2.5 font-mono text-xs leading-relaxed text-red-800">
              {detail}
            </p>
          )}
        </>
      )}
    </div>
  )
}
