// 所有 Claude API 呼叫的統一封裝（CLAUDE.md 第 5/8 節）
// 元件內禁止直接 fetch Worker，一律經過本模組

import type { ChatMessage } from './types'
import { clearAccessPassphrase, loadAccessPassphrase } from './accessGate'

/** 前端夾帶通關密碼的 header 名稱，要跟 worker/src/index.ts 的 ACCESS_HEADER 一致 */
const ACCESS_HEADER = 'x-lgl-access'

/** 有存密碼就夾帶；沒設定通關密碼的部署收到這個 header 也不會怎樣，Worker 端會忽略 */
function accessHeaders(): Record<string, string> {
  const passphrase = loadAccessPassphrase()
  return passphrase ? { [ACCESS_HEADER]: passphrase } : {}
}

export type AccessCheckResult = 'ok' | 'wrong' | 'unreachable'

async function checkAccessRequest(passphrase: string | null): Promise<AccessCheckResult> {
  const workerUrl = import.meta.env.VITE_WORKER_URL
  if (!workerUrl) return 'unreachable'
  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/api/verify-access`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(passphrase ? { [ACCESS_HEADER]: passphrase } : {}),
      },
      body: '{}',
    })
    if (res.ok) return 'ok'
    return res.status === 401 ? 'wrong' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

/**
 * 跟 Worker 確認這組通關密碼對不對——給 AccessGate 畫面用，
 * 讓使用者一輸入就知道密碼錯了，不用等到真的送出任務生成才發現。
 */
export function verifyAccessPassphrase(passphrase: string): Promise<AccessCheckResult> {
  return checkAccessRequest(passphrase)
}

/**
 * 探測這個部署到底有沒有開通關密碼功能。沒設定 ACCESS_PASSPHRASE 的部署
 * （沒特別選過 A 方案的家庭）不該平白多一道要輸入密碼的畫面——這支不帶
 * 密碼去問，Worker 沒設定就會直接放行，代表這道關卡本來就沒啟用。
 */
export function probeAccessGateNeeded(): Promise<AccessCheckResult> {
  return checkAccessRequest(null)
}

/**
 * Prompt 模組名稱。實際的 system prompt 內容與模型選擇都在 Worker
 * （`worker/src/prompts/`），前端只送模組名與變數。
 *
 * 這份清單是「跨 HTTP 邊界的契約」，要跟 worker/src/prompts/index.ts 的
 * PromptModule 保持一致。送出不認得的模組名，Worker 會回 400
 * unknown_prompt_module，不會靜默送出一份空 prompt。
 */
export type PromptModule =
  | 'taskGenerator'
  | 'dialogPartner'
  | 'discussPartner'
  | 'grader'
  | 'weeklyReport'
  | 'taigiScript'
  | 'translate'
  | 'readingAid'
  | 'extensive'
  | 'quizGenerator'
  | 'vocabEnrich'
  | 'particleTutor'
  | 'reviewPractice'
  | 'classicalAnnotate'
  | 'classicalTranslationGrade'

export type ClaudeErrorKind = 'network' | 'rate_limited' | 'api' | 'parse' | 'access_denied'

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
  /** 要用哪個 prompt 模組；Worker 依此組裝 system prompt 並決定模型與 token 上限 */
  promptModule: PromptModule
  /**
   * 填進 prompt 模板的變數。形狀由各模組在 `src/lib/prompts/` 的 Input 介面定義
   * （那些介面留在前端就是為了讓這裡有型別可依），實際組裝在 Worker。
   */
  vars: unknown
  messages: ChatMessage[]
  /** 只能往下調（省 token），超過模組預設上限的話 Worker 會夾回上限 */
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
  let res: Response
  try {
    res = await fetch(`${workerUrl.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...accessHeaders() },
      body: JSON.stringify({
        prompt: { module: args.promptModule, vars: args.vars },
        messages: args.messages,
        ...(args.maxTokens ? { max_tokens: args.maxTokens } : {}),
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
    let errorCode = ''
    try {
      const j = (await res.json()) as {
        error?: string | { message?: string }
        message?: string
      }
      if (typeof j.error === 'object' && j.error?.message) detail = j.error.message
      else if (j.message) detail = j.message
      else if (typeof j.error === 'string') detail = j.error
      if (typeof j.error === 'string') errorCode = j.error
    } catch {
      // 非 JSON 錯誤內容，僅回報狀態碼
    }
    if (res.status === 401 && errorCode === 'access_denied') {
      // 密碼被家人在別的裝置改掉，或本機存的密碼已經失效——清掉重來，
      // 並重新整理讓 AccessGate 重新掛載、讀到清空後的 localStorage，
      // 使用者會直接回到輸入畫面，而不是卡在一句看不懂的「AI 服務錯誤」
      clearAccessPassphrase()
      window.location.reload()
      throw new ClaudeError('access_denied', '通關密碼已失效', '通關密碼已變更，請重新輸入')
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
