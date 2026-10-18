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
  | 'songPicker'
  | 'songLesson'
  | 'videoPicker'
  | 'videoLesson'
  | 'articleLesson'
  | 'articlePicker'

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
  /**
   * 只能往下調（省 token），超過模組預設上限的話 Worker 會夾回上限。
   * 一般**不要傳**：上限的唯一來源是 worker/src/prompts/index.ts。以前各呼叫點
   * 都寫死一份，換成新 tokenizer（同樣文字多 30% token）時這些舊數字會把新上限
   * 壓回去、把教材截斷，所以 2026-10 全部拿掉了
   */
  maxTokens?: number
}

interface AnthropicResponse {
  /** 新一代模型會在 text 前面放 thinking／fallback 區塊，所以一律依 type 取，不能取 [0] */
  content?: Array<{ type: string; text?: string }>
  stop_reason?: string
}

interface ClaudeReply {
  text: string
  /** max_tokens＝被截斷；callClaudeJSON 解析失敗時用它講出真正的原因 */
  stopReason: string | undefined
}

/** 呼叫 Worker 代理，回傳純文字回覆 */
export async function callClaude(args: CallClaudeArgs): Promise<string> {
  return (await requestClaude(args)).text
}

async function requestClaude(args: CallClaudeArgs): Promise<ClaudeReply> {
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
    // fetch 自己丟例外＝請求根本沒完成。除了真的斷網，最常見的是
    // 「生成跑太久、連線被中斷」——期間畫面上什麼都沒有，使用者只會
    // 以為是網路爛，而實際上換個穩定的網路重試一次通常就過了
    throw new ClaudeError(
      'network',
      '無法連線到 AI 服務（fetch 失敗，請求沒有完成）',
      '連不上 AI 服務。可能是網路不穩，也可能是這次生成跑太久被中斷——換 Wi-Fi 或重試一次通常就會過。',
    )
  }

  if (res.status === 429) {
    throw new ClaudeError('rate_limited', '請求太頻繁，請一分鐘後再試')
  }
  if (!res.ok) {
    // 兩種錯誤格式：Anthropic 的 {error:{message}}、Worker 自己的 {error:'code', message}
    let detail = ''
    let errorCode = ''
    /** Worker 轉發 403 時，Anthropic 的原話放在這個欄位（Worker 自己的 message 是另一段中文） */
    let upstream = ''
    try {
      const j = (await res.json()) as {
        error?: string | { message?: string }
        message?: string
        upstream?: unknown
      }
      if (typeof j.upstream === 'string') upstream = j.upstream
      else if (j.upstream) upstream = JSON.stringify(j.upstream)
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
    // 402／403 是「帳號要處理」，不是「等一下再試就會好」。
    // 混進下面那句籠統的「稍後再試」會讓人一直重試一直失敗，
    // 卻完全不知道要去 console 看一眼（403 的官方定義是
    // permission_error：這組憑證的組織或 workspace 不被允許，
    // 或被區域限制／身分驗證擋下，而且明確標示為不可重試）
    if (res.status === 402) {
      throw new ClaudeError(
        'api',
        `AI 服務錯誤（402）${detail ? '：' + detail : ''}`,
        'AI 帳號的額度或付款方式有問題，重試不會好。請到 console.anthropic.com 看一下。',
      )
    }
    if (res.status === 403) {
      // 「Request not allowed」是另一回事：Anthropic 擋掉了這次請求的**發出地區**
      // （Worker 被分到香港的機房時會這樣），跟帳號、額度、金鑰都無關，而且時好時壞——
      // 說「重試不會好」就是在誤導。固定新加坡執行（worker/wrangler.toml 的 placement）
      // 之後應該不會再發生，但萬一又碰到，重試是對的建議
      if (/request not allowed/i.test(`${detail} ${upstream}`)) {
        throw new ClaudeError(
          'api',
          `AI 服務錯誤（403）：${detail}${upstream ? ` ／ Anthropic 回應：${upstream.slice(0, 200)}` : ''}`,
          'AI 服務這次沒接上，多半是連線路徑的問題，不是你的帳號。再按一次「重試」通常就會好；如果連續失敗，請回報。',
        )
      }
      throw new ClaudeError(
        'api',
        `AI 服務錯誤（403）${detail ? '：' + detail : ''}${upstream ? ` ／ Anthropic 回應：${upstream.slice(0, 200)}` : ''}`,
        'AI 帳號的權限被擋住了，重試不會好——這不是某個功能壞掉。請到 console.anthropic.com 檢查帳號狀態（額度、金鑰是否停用、有沒有要求身分驗證）。',
      )
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

  // 新一代模型有安全分類器，拒答時是 HTTP 200＋stop_reason: refusal，沒有任何文字。
  // 不先擋的話會落到下面的「回應為空」，看起來像系統壞掉；而且重試也不會好
  if (data.stop_reason === 'refusal') {
    throw new ClaudeError(
      'api',
      'AI 拒絕回答（stop_reason: refusal）',
      'AI 判斷這段內容不適合處理。換一份素材或換個說法再試，重試同一份不會有不同結果。',
    )
  }

  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  if (!text) throw new ClaudeError('api', `AI 回應為空（stop_reason: ${data.stop_reason ?? '無'}），請重試`)
  return { text, stopReason: data.stop_reason }
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
  let truncated = false
  for (let attempt = 0; attempt < 2; attempt++) {
    const { text, stopReason } = await requestClaude(args)
    truncated = stopReason === 'max_tokens'
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
  // 被截斷跟格式錯是兩回事：截斷代表那個模組的 token 上限給得太緊，重試幾次都一樣，
  // 要改的是 worker/src/prompts/index.ts 的 maxTokens。講清楚才查得到
  if (truncated) {
    throw new ClaudeError(
      'parse',
      `AI 回應被截斷（stop_reason: max_tokens，模組 ${args.promptModule}）`,
      'AI 這次寫太長被切斷了。可以再試一次；如果一直發生，請回報是哪個功能。',
    )
  }
  throw new ClaudeError(
    'parse',
    `AI 回傳格式異常，請重試（${String(lastError)}）`,
    'AI 回應的格式有點怪，請重試一次',
  )
}
