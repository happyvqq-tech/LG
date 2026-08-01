// 語音對話的共用元件：情境角色對話與討論文章重點兩種模式共用同一套
// 訊息列表、語音輸入與鍵盤降級。兩者只有 system prompt 與逐字稿存放欄位不同，
// 抽出來才不用把「錄音守衛」這種容易出錯的邏輯抄第三份。
import { useEffect, useRef, useState } from 'react'
import { type PromptModule, callClaude, ClaudeError } from '../lib/claude'
import { HINT_REQUEST, stripCompleteMarker, TASK_COMPLETE_MARKER } from '../lib/prompts/dialogPartner'
import { HoldToTalkRecognizer, speak, stopSpeaking, sttSupported } from '../lib/speech'
import type { ChatMessage, Language } from '../lib/types'

export default function VoiceChat({
  language,
  prompt,
  bootstrap,
  initialMessages,
  onMessages,
  rate,
  completeBanner,
  completeLabel,
  onCompleteAction,
}: {
  language: Language
  /** 要用哪個對話 prompt 模組與變數；實際的 prompt 內容在 Worker */
  prompt: { module: PromptModule; vars: unknown }
  /** 讓 AI 先開口的引導訊息，不顯示在畫面上 */
  bootstrap: ChatMessage
  /** 續接用的既有逐字稿（只在第一次掛載時採用） */
  initialMessages: ChatMessage[]
  /** 對話有更新時通知上層落庫 */
  onMessages: (messages: ChatMessage[]) => void
  rate: number
  completeBanner: string
  completeLabel: string
  onCompleteAction: () => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages)
  const [sending, setSending] = useState(false)
  const [recording, setRecording] = useState(false)
  const [completed, setCompleted] = useState(() =>
    initialMessages.some((m) => m.role === 'assistant' && m.content.includes(TASK_COMPLETE_MARKER)),
  )
  const [keyboardMode, setKeyboardMode] = useState(!sttSupported())
  const [draft, setDraft] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [retryable, setRetryable] = useState(false)

  const recognizerRef = useRef<HoldToTalkRecognizer | null>(null)
  // 錄音守衛用 ref 不用 state：state 在同一個 render 週期讀到的是舊值，
  // 擋不住連續兩次呼叫（原本 pointerup + pointerleave 會連續觸發，
  // 第二次拿到空逐字稿就誤報「沒有聽清楚」，看起來像按了沒反應）
  const recordingRef = useRef(false)
  const startedRef = useRef(false)
  const listEndRef = useRef<HTMLDivElement>(null)
  // requestReply 在 closure 裡跑，用 ref 才拿得到最新語速與 prompt
  const rateRef = useRef(rate)
  rateRef.current = rate
  const promptRef = useRef(prompt)
  promptRef.current = prompt

  useEffect(() => {
    return () => {
      stopSpeaking()
      recognizerRef.current?.cancel()
    }
  }, [])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // 沒有既有逐字稿時，由 AI 開場
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    if (initialMessages.length === 0) void requestReply([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function requestReply(history: ChatMessage[]) {
    // 開場白發生在使用者還沒點過任何東西時（頁面剛載入），iOS Safari 會把
    // 沒有手勢觸發的 speechSynthesis.speak() 靜默吃掉。之後的回覆都跟在
    // 使用者說完話之後，才自動唸出來；開場白可用訊息旁的 🔊 手動聽。
    const isOpening = history.length === 0
    setSending(true)
    setErrorMsg('')
    try {
      const reply = await callClaude({
        promptModule: promptRef.current.module,
        vars: promptRef.current.vars,
        messages: [bootstrap, ...history],
      })
      const withReply: ChatMessage[] = [...history, { role: 'assistant', content: reply }]
      setMessages(withReply)
      setRetryable(false)
      if (reply.includes(TASK_COMPLETE_MARKER)) setCompleted(true)
      onMessages(withReply)
      if (!isOpening) {
        void speak(stripCompleteMarker(reply), language, rateRef.current).catch(() => undefined)
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof ClaudeError ? e.friendlyMessage : `對話失敗：${String((e as Error).message)}`)
      setRetryable(true)
    } finally {
      setSending(false)
    }
  }

  function send(text: string) {
    if (!text.trim() || sending || completed) return
    stopSpeaking()
    const history: ChatMessage[] = [...messages, { role: 'user', content: text.trim() }]
    setMessages(history)
    void requestReply(history)
  }

  function startRecording() {
    if (sending || completed || recordingRef.current) return
    stopSpeaking()
    try {
      const rec = new HoldToTalkRecognizer()
      recognizerRef.current = rec
      rec.start(language)
      recordingRef.current = true
      setRecording(true)
      setErrorMsg('')
    } catch (e: unknown) {
      setErrorMsg((e as Error).message)
      setKeyboardMode(true)
    }
  }

  async function stopRecording() {
    if (!recordingRef.current) return
    recordingRef.current = false
    setRecording(false)
    try {
      const text = (await recognizerRef.current?.stop()) ?? ''
      if (text) send(text)
      else setErrorMsg('沒有聽清楚，請再說一次或改用鍵盤輸入')
    } catch (e: unknown) {
      setErrorMsg((e as Error).message)
      setKeyboardMode(true)
    }
  }

  /** 點一下開始、再點一下送出——比「按住不放」在手機上可靠得多 */
  async function toggleRecording() {
    if (recordingRef.current) await stopRecording()
    else startRecording()
  }

  return (
    <>
      <section className="mt-3 flex-1 space-y-3 overflow-y-auto rounded-2xl bg-white p-4 shadow-inner">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                m.role === 'user' ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-800'
              }`}
            >
              {m.content === HINT_REQUEST ? '🆘 我卡住了，給點提示' : stripCompleteMarker(m.content)}
              {m.role === 'assistant' && (
                <button
                  onClick={() => void speak(stripCompleteMarker(m.content), language, rate).catch(() => undefined)}
                  className="ml-2 align-middle text-sm"
                  aria-label="重聽這句"
                >
                  🔊
                </button>
              )}
            </div>
          </div>
        ))}
        {sending && <p className="text-sm text-slate-400">對方正在回覆…</p>}
        {completed && (
          <div className="rounded-2xl bg-amber-50 p-4 text-center text-lg font-bold text-amber-700">
            {completeBanner}
          </div>
        )}
        <div ref={listEndRef} />
      </section>

      {errorMsg && (
        <div className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-600">
          {errorMsg}
          {retryable && (
            <button
              onClick={() => void requestReply(messages)}
              className="ml-3 rounded bg-red-600 px-3 py-1 font-semibold text-white"
            >
              重試
            </button>
          )}
        </div>
      )}

      <footer className="mt-3 pb-2">
        {completed ? (
          <button
            onClick={() => {
              stopSpeaking()
              onCompleteAction()
            }}
            className="w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-95"
          >
            {completeLabel}
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {keyboardMode ? (
                <>
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        send(draft)
                        setDraft('')
                      }
                    }}
                    placeholder={sttSupported() ? '輸入回覆…' : '此瀏覽器不支援語音，請用鍵盤輸入'}
                    className="min-w-0 flex-1 rounded-xl border border-slate-300 p-3"
                  />
                  <button
                    onClick={() => {
                      send(draft)
                      setDraft('')
                    }}
                    disabled={sending || !draft.trim()}
                    className="rounded-xl bg-teal-600 px-5 py-3 font-bold text-white disabled:opacity-40"
                  >
                    送出
                  </button>
                </>
              ) : (
                <button
                  onClick={() => void toggleRecording()}
                  disabled={sending}
                  className={`flex-1 select-none rounded-xl py-4 text-lg font-bold text-white transition disabled:opacity-40 ${
                    recording ? 'animate-pulse bg-red-500' : 'bg-teal-600'
                  }`}
                >
                  {recording ? '⏹ 說完了，送出' : '🎙 開始說話'}
                </button>
              )}
              <button
                onClick={() => send(HINT_REQUEST)}
                disabled={sending}
                className="rounded-xl bg-amber-100 px-4 py-3 font-bold text-amber-700 disabled:opacity-40"
                title="卡關求助"
              >
                🆘
              </button>
            </div>
            {sttSupported() && (
              <button
                onClick={() => setKeyboardMode(!keyboardMode)}
                className="mt-2 w-full text-center text-sm text-slate-400"
              >
                {keyboardMode ? '改用語音輸入' : '改用鍵盤輸入'}
              </button>
            )}
          </>
        )}
      </footer>
    </>
  )
}
