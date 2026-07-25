import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { callClaude, ClaudeError } from '../lib/claude'
import {
  DIALOG_BOOTSTRAP,
  dialogPartnerSystemPrompt,
  HINT_REQUEST,
  stripCompleteMarker,
  TASK_COMPLETE_MARKER,
} from '../lib/prompts/dialogPartner'
import { updateTaskJson } from '../lib/taskService'
import { HoldToTalkRecognizer, speak, stopSpeaking, sttSupported } from '../lib/speech'
import TaskNav from '../components/TaskNav'
import type { ChatMessage, Task } from '../lib/types'

export default function Speaking() {
  const navigate = useNavigate()
  const { task, setTask, loading } = useActiveTask()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sending, setSending] = useState(false)
  const [recording, setRecording] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [keyboardMode, setKeyboardMode] = useState(!sttSupported())
  const [draft, setDraft] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [retryText, setRetryText] = useState<string | null>(null)

  const recognizerRef = useRef<HoldToTalkRecognizer | null>(null)
  const startedRef = useRef(false)
  const taskRef = useRef<Task | null>(null)
  const listEndRef = useRef<HTMLDivElement>(null)

  taskRef.current = task

  useEffect(() => {
    return () => {
      stopSpeaking()
      recognizerRef.current?.cancel()
    }
  }, [])

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // 任務載入後：續接既有逐字稿，或由 AI 開場
  useEffect(() => {
    if (!task || startedRef.current) return
    startedRef.current = true
    const saved = task.task_json.speaking_transcript
    if (saved && saved.length > 0) {
      setMessages(saved)
      setCompleted(saved.some((m) => m.role === 'assistant' && m.content.includes(TASK_COMPLETE_MARKER)))
    } else {
      void requestReply([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task])

  /** 送出對話（history 為畫面上的訊息；AI 開場時傳空陣列） */
  async function requestReply(history: ChatMessage[]) {
    const t = taskRef.current
    if (!t) return
    setSending(true)
    setErrorMsg('')
    try {
      const system = dialogPartnerSystemPrompt({
        language: t.language === '日文' ? '日文' : '英文',
        roleSetup: t.task_json.speaking_role_setup,
        goal: t.task_json.speaking_goal,
      })
      const reply = await callClaude({
        module: 'dialogPartner',
        system,
        messages: [DIALOG_BOOTSTRAP, ...history],
      })
      const withReply: ChatMessage[] = [...history, { role: 'assistant', content: reply }]
      setMessages(withReply)
      setRetryText(null)
      if (reply.includes(TASK_COMPLETE_MARKER)) setCompleted(true)
      // 逐字稿全程落庫
      const updated = await updateTaskJson(t, { speaking_transcript: withReply })
      setTask(updated)
      void speak(stripCompleteMarker(reply), t.language, 1).catch(() => undefined)
    } catch (e: unknown) {
      const msg = e instanceof ClaudeError ? e.message : `對話失敗：${String((e as Error).message)}`
      setErrorMsg(msg)
      const lastUser = history[history.length - 1]
      setRetryText(lastUser?.role === 'user' ? lastUser.content : '')
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

  function retry() {
    // 訊息已在畫面上，直接重送目前的 history
    void requestReply(messages)
  }

  function startRecording() {
    if (sending || completed || recording) return
    stopSpeaking()
    try {
      const rec = new HoldToTalkRecognizer()
      recognizerRef.current = rec
      rec.start(task?.language ?? '英文')
      setRecording(true)
      setErrorMsg('')
    } catch (e: unknown) {
      setErrorMsg((e as Error).message)
      setKeyboardMode(true)
    }
  }

  async function stopRecording() {
    if (!recording) return
    setRecording(false)
    try {
      const text = (await recognizerRef.current?.stop()) ?? ''
      if (text) send(text)
      else setErrorMsg('沒有聽清楚，請再試一次或改用鍵盤輸入')
    } catch (e: unknown) {
      setErrorMsg((e as Error).message)
      setKeyboardMode(true)
    }
  }

  if (loading || !task) return <p className="p-10 text-center text-slate-400">載入中…</p>

  return (
    <main className="mx-auto flex h-dvh max-w-xl flex-col p-4">
      <TaskNav current="speaking" />
      <header className="px-2">
        <p className="text-sm font-semibold text-teal-700">第三關・口說</p>
        <h1 className="text-xl font-bold">{task.task_json.scenario_title}</h1>
        <p className="mt-1 text-sm text-slate-500">目標：{task.task_json.speaking_goal}</p>
      </header>

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
                  onClick={() => void speak(stripCompleteMarker(m.content), task.language, 1).catch(() => undefined)}
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
          <div className="animate-bounce rounded-2xl bg-amber-50 p-4 text-center text-lg font-bold text-amber-700">
            🎉 任務達成！口說練習完成
          </div>
        )}
        <div ref={listEndRef} />
      </section>

      {errorMsg && (
        <div className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-600">
          {errorMsg}
          {retryText !== null && (
            <button onClick={retry} className="ml-3 rounded bg-red-600 px-3 py-1 font-semibold text-white">
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
              navigate('/writing')
            }}
            className="w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-95"
          >
            進入寫作
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
                  onPointerDown={startRecording}
                  onPointerUp={() => void stopRecording()}
                  onPointerLeave={() => void stopRecording()}
                  onPointerCancel={() => void stopRecording()}
                  disabled={sending}
                  className={`flex-1 touch-none select-none rounded-xl py-4 text-lg font-bold text-white transition disabled:opacity-40 ${
                    recording ? 'scale-[0.98] bg-red-500' : 'bg-teal-600'
                  }`}
                >
                  {recording ? '🎙 錄音中…放開送出' : '🎙 按住說話'}
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
    </main>
  )
}
