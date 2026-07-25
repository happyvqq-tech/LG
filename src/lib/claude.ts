// 所有 Claude API 呼叫的統一封裝（CLAUDE.md 第 5/8 節）
// 元件內禁止直接 fetch Worker，一律經過本模組

import type { ChatMessage } from './types'

export type ClaudeModule = 'taskGenerator' | 'dialogPartner' | 'grader' | 'weeklyReport'

// module → model 對照與 max_tokens 預設（CLAUDE.md 第 5 節）
const MODULE_CONFIG: Record<ClaudeModule, { model: string; maxTokens: number }> = {
  taskGenerator: { model: 'claude-haiku-4-5', maxTokens: 3000 },
  dialogPartner: { model: 'claude-haiku-4-5', maxTokens: 1024 },
  grader: { model: 'claude-sonnet-4-6', maxTokens: 3000 },
  weeklyReport: { model: 'claude-sonnet-4-6', maxTokens: 2000 },
}

export type ClaudeErrorKind = 'network' | 'rate_limited' | 'api' | 'parse'

export class ClaudeError extends Error {
  kind: ClaudeErrorKind
  constructor(kind: ClaudeErrorKind, message: string) {
    super(message)
    this.name = 'ClaudeError'
    this.kind = kind
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
    throw new ClaudeError('api', '缺少 VITE_WORKER_URL，請依 .env.example 建立 .env')
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
    throw new ClaudeError('api', `AI 服務錯誤（${res.status}）${detail ? '：' + detail : ''}`)
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
  throw new ClaudeError('parse', `AI 回傳格式異常，請重試（${String(lastError)}）`)
}
