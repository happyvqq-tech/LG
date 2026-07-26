// 跟讀朗讀：AI 唸一句、使用者跟讀一句，依文字吻合度＋跟上 AI 節奏的程度估算分數。
// 每句到達 80 分才能進下一句；卡住的話（麥克風/口音辨識不穩）可以跳過，不硬卡關。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { speak, splitSentences, stopSpeaking, sttSupported, ttsSupported, HoldToTalkRecognizer } from '../lib/speech'
import { computeShadowScore, SHADOW_PASS_THRESHOLD, type ShadowScoreResult } from '../lib/prosodyScore'
import { logActivity } from '../lib/streakService'
import { ensureListeningTranslation } from '../lib/translationService'
import TaskNav from '../components/TaskNav'
import SpeedPicker from '../components/SpeedPicker'
import { useSpeechRate } from '../lib/useSpeechRate'

type Phase = 'idle' | 'ai-reading' | 'recording' | 'scored'

export default function Shadowing() {
  const navigate = useNavigate()
  const { task, setTask, loading } = useActiveTask()
  const sentences = useMemo(() => splitSentences(task?.task_json.listening_script ?? ''), [task])
  const lang = task?.language ?? '英文'
  const { level: speedLevel, rate, setLevel: setSpeedLevel } = useSpeechRate()

  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [attempts, setAttempts] = useState(0)
  const [result, setResult] = useState<ShadowScoreResult | null>(null)
  const [recognizedText, setRecognizedText] = useState('')
  const [passed, setPassed] = useState<Set<number>>(new Set())
  const [errorMsg, setErrorMsg] = useState('')
  const [finished, setFinished] = useState(false)
  const [hasHeardDemo, setHasHeardDemo] = useState(false)
  const [showZh, setShowZh] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState('')

  const recognizerRef = useRef<HoldToTalkRecognizer | null>(null)
  // 守衛用 ref 不用 phase state，理由同 Speaking.tsx 的 stopRecording：
  // 手機上 pointerup 後會再補一個 pointerleave，state 擋不住連續兩次呼叫
  const recordingRef = useRef(false)
  const aiDurationRef = useRef(0)
  const userStartRef = useRef(0)
  const loggedRef = useRef(false)

  useEffect(() => {
    return () => {
      stopSpeaking()
      recognizerRef.current?.cancel()
    }
  }, [])

  const sentence = sentences[index] ?? ''
  const pass = result !== null && result.score >= SHADOW_PASS_THRESHOLD

  /** 換到新句子：連嘗試次數也歸零 */
  function resetForSentence() {
    setPhase('idle')
    setAttempts(0)
    setResult(null)
    setRecognizedText('')
    setErrorMsg('')
    setHasHeardDemo(false)
    aiDurationRef.current = 0
  }

  /**
   * 同一句再試一次：刻意不歸零 attempts。跟 resetForSentence 曾經是同一個函式，
   * 導致「跳過這句」永遠等不到 attempts>=2 的那一刻，連續唸錯幾次也跳不出去
   * （見稽核報告 P1-1）。
   */
  function retrySentence() {
    setPhase('idle')
    setResult(null)
    setRecognizedText('')
    setErrorMsg('')
    setHasHeardDemo(false)
    aiDurationRef.current = 0
  }

  async function playAiDemo() {
    stopSpeaking()
    setErrorMsg('')
    setPhase('ai-reading')
    const t0 = performance.now()
    try {
      await speak(sentence, lang, rate)
      aiDurationRef.current = performance.now() - t0
      setHasHeardDemo(true)
    } catch (e: unknown) {
      setErrorMsg((e as Error).message)
    } finally {
      setPhase('idle')
    }
  }

  function startRecording() {
    // 瀏覽器對 disabled 按鈕只保證擋掉 click，低階事件不一定被擋（實測過），
    // 所以這裡不能只靠 DOM 的 disabled 屬性（見稽核報告 P1-2）
    if (!hasHeardDemo || phase === 'ai-reading' || recordingRef.current) return
    stopSpeaking()
    try {
      const rec = new HoldToTalkRecognizer()
      recognizerRef.current = rec
      rec.start(lang)
      userStartRef.current = performance.now()
      recordingRef.current = true
      setPhase('recording')
      setErrorMsg('')
    } catch (e: unknown) {
      setErrorMsg((e as Error).message)
    }
  }

  async function stopRecording() {
    if (!recordingRef.current) return
    recordingRef.current = false
    const userDurationMs = performance.now() - userStartRef.current
    try {
      const transcript = (await recognizerRef.current?.stop()) ?? ''
      const confidence = recognizerRef.current?.lastConfidence ?? 0
      if (!transcript) {
        setErrorMsg('沒有聽清楚，請再試一次')
        setPhase('idle')
        return
      }
      setRecognizedText(transcript)
      const scored = computeShadowScore({
        targetText: sentence,
        recognizedText: transcript,
        confidence,
        aiDurationMs: aiDurationRef.current,
        userDurationMs,
      })
      setResult(scored)
      setAttempts((a) => a + 1)
      setPhase('scored')
      if (scored.score >= SHADOW_PASS_THRESHOLD) {
        setPassed((prev) => new Set(prev).add(index))
      }
    } catch (e: unknown) {
      setErrorMsg((e as Error).message)
      setPhase('idle')
    }
  }

  async function toggleShowZh() {
    if (showZh) {
      setShowZh(false)
      return
    }
    setShowZh(true)
    if (!task || task.task_json.listening_translation) return
    setTranslating(true)
    setTranslateError('')
    try {
      const result = await ensureListeningTranslation(task)
      setTask(result.task)
    } catch (e: unknown) {
      setTranslateError(`翻譯失敗：${String((e as Error).message)}`)
    } finally {
      setTranslating(false)
    }
  }

  /** 點一下開始、再點一下送出——比「按住不放」在手機上可靠得多 */
  async function toggleRecording() {
    if (recordingRef.current) await stopRecording()
    else startRecording()
  }

  function goNext(skip = false) {
    if (!skip && !pass) return
    stopSpeaking()
    if (index + 1 >= sentences.length) {
      setFinished(true)
      if (!loggedRef.current && task) {
        loggedRef.current = true
        void logActivity(task.profile_id).catch(() => undefined)
      }
    } else {
      setIndex((i) => i + 1)
      resetForSentence()
    }
  }

  if (loading || !task) return <p className="p-10 text-center text-slate-400">載入中…</p>

  if (!sttSupported() || !ttsSupported()) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
        <TaskNav current="speaking" />
        <p className="rounded-xl bg-amber-50 p-4 text-amber-700">
          此瀏覽器不支援語音播放或語音辨識，跟讀朗讀需要兩者才能運作，請改用 Chrome 或 Edge。
        </p>
      </main>
    )
  }

  if (sentences.length === 0) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
        <TaskNav current="speaking" />
        <p className="rounded-xl bg-amber-50 p-4 text-amber-700">這個任務沒有聽力稿可以跟讀。</p>
      </main>
    )
  }

  if (finished) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl lg:max-w-3xl flex-col p-6">
        <TaskNav current="speaking" />
        <div className="mt-8 rounded-3xl bg-white p-8 text-center shadow">
          <p className="text-4xl">🏆</p>
          <p className="mt-3 text-xl font-bold">跟讀朗讀完成！</p>
          <p className="mt-1 text-slate-500">全部 {sentences.length} 句都跟讀過關了</p>
          <button
            onClick={() => navigate('/speaking')}
            className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white"
          >
            回口說選單
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl lg:max-w-3xl flex-col p-6 pb-10">
      <TaskNav current="speaking" />
      <header>
        <p className="text-sm font-semibold text-teal-700">🔁 跟讀朗讀（額外練習）</p>
        <h1 className="mt-1 break-words text-xl font-bold">{task.task_json.scenario_title}</h1>
        <p className="mt-1 text-sm text-slate-400">
          第 {index + 1} / {sentences.length} 句・已過關 {passed.size} 句
        </p>
      </header>

      <div className="mt-2 flex gap-1">
        {sentences.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              passed.has(i) ? 'bg-teal-500' : i === index ? 'bg-teal-200' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>

      <section className="mt-6 rounded-3xl bg-white p-6 shadow">
        <p className="text-lg font-semibold leading-relaxed">{sentence}</p>

        {showZh && (
          <div className="mt-1.5 min-h-[1.25rem]">
            {translating && <p className="text-sm text-slate-400">翻譯中…</p>}
            {translateError && <p className="text-sm text-red-600">{translateError}</p>}
            {task.task_json.listening_translation && !translating && (
              <p className="text-teal-700">{task.task_json.listening_translation[index]}</p>
            )}
          </div>
        )}
        <button
          onClick={() => void toggleShowZh()}
          className={`mt-2 rounded-full px-3 py-1 text-xs font-semibold ${
            showZh ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {showZh ? '隱藏中文' : '顯示中文'}
        </button>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={() => void playAiDemo()}
            disabled={phase === 'ai-reading' || phase === 'recording'}
            className="flex items-center gap-1.5 rounded-full bg-slate-100 px-4 py-2.5 font-semibold text-slate-600 disabled:opacity-40"
          >
            {phase === 'ai-reading' ? '🔊 播放中…' : '▶ 聽 AI 示範'}
          </button>
          <div className="min-w-0 flex-1">
            <SpeedPicker level={speedLevel} onChange={setSpeedLevel} showHint={false} compact />
          </div>
        </div>

        <button
          onClick={() => void toggleRecording()}
          disabled={!hasHeardDemo && phase !== 'recording'}
          className={`mt-5 w-full select-none rounded-xl py-4 text-lg font-bold text-white transition disabled:opacity-40 ${
            phase === 'recording' ? 'animate-pulse bg-red-500' : 'bg-teal-600'
          }`}
        >
          {phase === 'recording' ? '⏹ 唸完了，看分數' : '🎙 開始跟讀這句'}
        </button>
        {!hasHeardDemo && (
          <p className="mt-1.5 text-center text-xs text-slate-400">先聽一次 AI 示範，再開始跟讀</p>
        )}

        {errorMsg && <p className="mt-3 text-center text-red-600">{errorMsg}</p>}

        {result && (
          <div
            className={`mt-4 rounded-2xl p-4 ${
              pass ? 'bg-green-50 ring-1 ring-green-200' : 'bg-amber-50 ring-1 ring-amber-200'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <p className={`text-2xl font-bold ${pass ? 'text-green-600' : 'text-amber-600'}`}>
                {result.score} 分
              </p>
              <p className="text-xs text-slate-400">80 分過關</p>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              你說的：「{recognizedText}」
            </p>
            <p className="mt-1 text-xs text-slate-400">
              文字吻合 {Math.round(result.textAccuracy * 100)}% ・ 節奏接近度 {Math.round(result.timing * 100)}%
            </p>
            <p className="mt-1.5 text-sm font-semibold text-amber-700">
              ⓘ 這是瀏覽器語音辨識估算的分數，不是真正的聲學評分
            </p>
            <div className="mt-3 flex gap-2">
              {!pass && (
                <button
                  onClick={retrySentence}
                  className="flex-1 rounded-xl bg-slate-100 py-2.5 font-semibold text-slate-600"
                >
                  再試一次
                </button>
              )}
              {pass ? (
                <button
                  onClick={() => goNext(false)}
                  className="flex-1 rounded-xl bg-teal-600 py-2.5 font-bold text-white"
                >
                  {index + 1 < sentences.length ? '下一句 →' : '完成 🎉'}
                </button>
              ) : (
                attempts >= 2 && (
                  <button
                    onClick={() => goNext(true)}
                    className="flex-1 rounded-xl bg-slate-50 py-2.5 text-sm font-semibold text-slate-400"
                  >
                    跳過這句
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
