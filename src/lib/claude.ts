// 所有 Claude API 呼叫的統一封裝（CLAUDE.md 第 5/8 節）
// 元件內禁止直接 fetch Worker，一律經過本模組

import type { ChatMessage } from './types'

export type ClaudeModule =
  | 'taskGenerator'
  | 'dialogPartner'
  | 'grader'
  | 'weeklyReport'
  | 'taigiScript'

// module → model 對照與 max_tokens 預設（CLAUDE.md 第 5 節）
const MODULE_CONFIG: Record<ClaudeModule, { model: string; maxTokens: number }> = {
  taskGenerator: { model: 'claude-haiku-4-5', maxTokens: 3000 },
  dialogPartner: { model: 'claude-haiku-4-5', maxTokens: 1024 },
  grader: { model: 'claude-sonnet-4-6', maxTokens: 3000 },
  weeklyReport: { model: 'claude-sonnet-4-6', maxTokens: 2000 },
  // 台語漢字用字與台羅拼音要正確，這比一般任務生成難，用能力較強的模型
  taigiScript: { model: 'claude-sonnet-4-6', maxTokens: 3000 },
}

export type ClaudeErrorKind = 'network' | 'rate_limited' | 'api' | 'parse'

export class ClaudeError extends Error {
  kind: ClaudeErrorKind
  /**
   * 給使用者看的白話訊息。技術細節（狀態碼、原始 API 錯誤字串、環境變數
   * 名稱）留在 message 供開發除錯，不該直接出現在一般家庭成員眼前
   * （見稽核報告 P2-1）。
   */
  friendlyMessage: string
  constructor(kind: ClaudeErrorKind, message: string, friendlyMessage?: string) {
    super(message)
    this.name = 'ClaudeError'
    this.kind = kind
    this.friendlyMessage = friendlyMessage ?? message
  }
}

export interface CallClaudeArgs {
  module: ClaudeModule
  system: string
  messages: ChatMessage[]
  maxTokens?: number
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>
}

/** 呼叫 Worker 代理，回傳純文字回覆 */
export async function callClaude(args: CallClaudeArgs): Promise<string> {
  const workerUrl = import.meta.env.VITE_WORKER_URL
  if (!workerUrl) {
    throw new ClaudeError(
      'api',
      '缺少 VITE_WORKER_URL，請依 .env.example 建立 .env',
      'AI 服務目前無法使用，請稍後再試',
    )
  }
  const cfg = MODULE_CONFIG[args.module]

  let res: Response
  try {
    res = await fetch(`${workerUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        system: args.system,
        messages: args.messages,
        max_tokens: args.maxTokens ?? cfg.maxTokens,
      }),
    })
  } catch {
    throw new ClaudeError('network', '無法連線到 AI 服務，請檢查網路後重試')
  }

  if (res.status === 429) {
    throw new ClaudeError('rate_limited', '請求太頻繁，請一分鐘後再試')
  }
  if (!res.ok) {
    // 兩種錯誤格式：Anthropic 的 {error:{message}}、Worker 自己的 {error:'code', message}
    let detail = ''
    try {
      const j = (await res.json()) as {
        error?: string | { message?: string }
        message?: string
      }
      if (typeof j.error === 'object' && j.error?.message) detail = j.error.message
      else if (j.message) detail = j.message
      else if (typeof j.error === 'string') detail = j.error
    } catch {
      // 非 JSON 錯誤內容，僅回報狀態碼
    }
    if (res.status === 529 || res.status === 503) {
      throw new ClaudeError('api', 'AI 服務忙碌中，稍等幾秒再按重試')
    }
    // 原始技術細節（狀態碼、後端錯誤字串）留在 message 供除錯，
    // 使用者看到的是白話的 friendlyMessage（見稽核報告 P2-1）
    throw new ClaudeError(
      'api',
      `AI 服務錯誤（${res.status}）${detail ? '：' + detail : ''}`,
      'AI 服務暫時發生問題，請稍後再試',
    )
  }

  const data = (await res.json()) as AnthropicResponse
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  if (!text) throw new ClaudeError('api', 'AI 回應為空，請重試')
  return text
}

/** 剝除 markdown 圍欄並擷取最外層 JSON 物件 */
export function stripJsonFences(raw: string): string {
  let s = raw.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first !== -1 && last > first) s = s.slice(first, last + 1)
  return s.trim()
}

/**
 * 呼叫並解析 JSON 輸出；解析（或驗證）失敗自動重試一次（CLAUDE.md 第 5 節）
 */
export async function callClaudeJSON<T>(
  args: CallClaudeArgs,
  validate?: (v: unknown) => v is T,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callClaude(args)
    try {
      const parsed = JSON.parse(stripJsonFences(text)) as unknown
      if (validate && !validate(parsed)) {
        throw new Error('JSON 結構不符預期')
      }
      return parsed as T
    } catch (e) {
      lastError = e
    }
  }
  throw new ClaudeError(
    'parse',
    `AI 回傳格式異常，請重試（${String(lastError)}）`,
    'AI 回應的格式有點怪，請重試一次',
  )
}
