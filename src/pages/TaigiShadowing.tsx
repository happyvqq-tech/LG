// 台語跟讀：AI 唸一句、使用者跟著唸一句，比對語調與節奏給分。
//
// 跟英日韓的 Shadowing.tsx 差在評分方式。那邊用瀏覽器的語音辨識把使用者
// 說的話轉成文字再比對，但語音辨識沒有台語（硬用 zh-TW 會辨識成一堆不相干
// 的國語）。所以台語改成把兩段聲音直接拿來比——音高曲線像不像、輕重快慢
// 像不像（見 audioProsody.ts）。比的是語調，正好就是跟讀要練的東西。
//
// 順帶的好處：錄音留著，使用者可以「聽 AI ↔ 聽自己」自己來回對照，
// 這是分數給不了的回饋。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  getTaigiScript,
  loadTaigiProgress,
  saveTaigiProgress,
  type TaigiScriptRow,
} from '../lib/taigiService'
import { loadTaigiVoice, clampTaigiSpeed, isTaigiSpeedClamped, type TaigiVoiceId } from '../lib/taigiVoice'
import { getTaigiAudioUrl, playTaigi, preloadTaigi, stopTaigi } from '../lib/taigiTts'
import { AudioClipRecorder, decodeAudio, recordingSupported } from '../lib/audioCapture'
import { computeProsodyScore, TAIGI_PASS_THRESHOLD, type ProsodyScoreResult } from '../lib/audioProsody'
import { logActivity } from '../lib/streakService'
import { useProfile } from '../lib/profileContext'
import { useSpeechRate } from '../lib/useSpeechRate'
import SpeedPicker from '../components/SpeedPicker'

type Phase = 'idle' | 'ai-reading' | 'recording' | 'scoring' | 'scored'

export default function TaigiShadowing() {
  const { scriptId } = useParams<{ scriptId: string }>()
  const navigate = useNavigate()
  const { profile } = useProfile()
  const { level: speedLevel, rate, setLevel: setSpeedLevel } = useSpeechRate()

  const [script, setScript] = useState<TaigiScriptRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [index, setIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [attempts, setAttempts] = useState(0)
  const [result, setResult] = useState<ProsodyScoreResult | null>(null)
  const [myClipUrl, setMyClipUrl] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [passed, setPassed] = useState<Set<number>>(new Set())
  const [hasHeardDemo, setHasHeardDemo] = useState(false)
  const [showTailo, setShowTailo] = useState(true)
  const [showZh, setShowZh] = useState(false)
  const [finished, setFinished] = useState(false)

  const voice = useMemo<TaigiVoiceId>(() => loadTaigiVoice(), [])
  const recorderRef = useRef<AudioClipRecorder | null>(null)
  // 守衛用 ref 不用 phase state：手機上點擊事件可能連著來兩次，
  // React state 還沒 flush 就會讓第二次也通過（VoiceChat.tsx 踩過同樣的坑）
  const recordingRef = useRef(false)
  const loggedRef = useRef(false)

  useEffect(() => {
    if (!scriptId) return
    setLoading(true)
    getTaigiScript(scriptId)
      .then((s) => {
        setScript(s)
        if (s && profile) setPassed(loadTaigiProgress(profile.id, s.id))
      })
      .catch((e: unknown) => setErrorMsg(`讀取腳本失敗：${String((e as Error).message)}`))
      .finally(() => setLoading(false))
    return () => {
      stopTaigi()
      recorderRef.current?.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptId])

  const lines = script?.lines ?? []
  const line = lines[index]
  const pass = result !== null && result.score >= TAIGI_PASS_THRESHOLD

  useEffect(() => {
    if (lines.length === 0) return
    preloadTaigi(
      lines.slice(index, index + 2).map((l) => l.hanji),
      voice,
      rate,
    )
  }, [lines, index, voice, rate])

  /** 換新句子：連嘗試次數一起歸零 */
  function resetForSentence() {
    setPhase('idle')
    setAttempts(0)
    setResult(null)
    setMyClipUrl(null)
    setErrorMsg('')
    setHasHeardDemo(false)
  }

  /** 同一句再試一次：刻意保留 attempts，不然「跳過這句」永遠不會出現 */
  function retrySentence() {
    setPhase('idle')
    setResult(null)
    setMyClipUrl(null)
    setErrorMsg('')
  }

  async function playAiDemo() {
    if (!line) return
    stopTaigi()
    setErrorMsg('')
    setPhase('ai-reading')
    try {
      await playTaigi(line.hanji, voice, rate)
      setHasHeardDemo(true)
    } catch (e: unknown) {
      const err = e as { friendlyMessage?: string; message: string }
      setErrorMsg(err.friendlyMessage ?? err.message)
    } finally {
      setPhase('idle')
    }
  }

  async function startRecording() {
    if (!hasHeardDemo || recordingRef.current || phase === 'ai-reading') return
    stopTaigi()
    setErrorMsg('')
    try {
      const rec = new AudioClipRecorder()
      await rec.start()
      recorderRef.current = rec
      recordingRef.current = true
      setPhase('recording')
    } catch (e: unknown) {
      const err = e as { friendlyMessage?: string; message: string }
      setErrorMsg(err.friendlyMessage ?? err.message)
      setPhase('idle')
    }
  }

  async function stopRecording() {
    if (!recordingRef.current || !line) return
    recordingRef.current = false
    setPhase('scoring')
    try {
      const clip = await recorderRef.current?.stop()
      if (!clip) {
        setErrorMsg('沒有錄到聲音，請再試一次')
        setPhase('idle')
        return
      }
      setMyClipUrl(clip.url)

      const aiUrl = await getTaigiAudioUrl(line.hanji, voice, rate)
      const [ai, mine] = await Promise.all([decodeAudio(aiUrl), decodeAudio(clip.url)])
      const scored = computeProsodyScore({
        aiSamples: ai.samples,
        aiSampleRate: ai.sampleRate,
        userSamples: mine.samples,
        userSampleRate: mine.sampleRate,
      })
      setResult(scored)
      setAttempts((a) => a + 1)
      setPhase('scored')
      if (!scored.hasVoice) setErrorMsg('沒有聽到你的聲音，確認麥克風有收到音再試一次')
      if (scored.score >= TAIGI_PASS_THRESHOLD) markPassed(index)
    } catch (e: unknown) {
      const err = e as { friendlyMessage?: string; message: string }
      setErrorMsg(err.friendlyMessage ?? err.message)
      setPhase('idle')
    }
  }

  function markPassed(at: number) {
    setPassed((prev) => {
      const next = new Set(prev).add(at)
      if (profile && script) saveTaigiProgress(profile.id, script.id, next)
      return next
    })
  }

  async function toggleRecording() {
    if (recordingRef.current) await stopRecording()
    else await startRecording()
  }

  function playMyClip() {
    if (!myClipUrl) return
    stopTaigi()
    void new Audio(myClipUrl).play().catch(() => undefined)
  }

  function goNext(skip = false) {
    if (!skip && !pass) return
    stopTaigi()
    if (index + 1 >= lines.length) {
      setFinished(true)
      if (!loggedRef.current && profile) {
        loggedRef.current = true
        void logActivity(profile.id).catch(() => undefined)
      }
    } else {
      setIndex((i) => i + 1)
      resetForSentence()
    }
  }

  if (loading) return <p className="p-10 text-center text-slate-400">載入中…</p>

  if (!recordingSupported()) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
        <button onClick={() => navigate('/taigi')} className="text-sm text-slate-500">
          ← 回台語首頁
        </button>
        <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-700">
          這個瀏覽器不支援錄音，跟讀評分需要錄下你的聲音才能比對，請改用 Chrome 或 Safari。
          只想聽的話可以先去「聽」的部分。
        </p>
      </main>
    )
  }

  if (!script || lines.length === 0) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
        <button onClick={() => navigate('/taigi')} className="text-sm text-slate-500">
          ← 回台語首頁
        </button>
        <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-700">{errorMsg || '這份腳本沒有內容'}</p>
      </main>
    )
  }

  if (finished) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl lg:max-w-3xl flex-col p-6">
        <div className="mt-10 rounded-3xl bg-white p-8 text-center shadow">
          <p className="text-4xl">🏆</p>
          <p className="mt-3 text-xl font-bold">跟讀完成！</p>
          <p className="mt-1 text-slate-500">
            全部 {lines.length} 句，過關 {passed.size} 句
          </p>
          <button
            onClick={() => navigate('/taigi')}
            className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white"
          >
            回台語首頁
          </button>
        </div>
      </main>
    )
  }

  const clamped = isTaigiSpeedClamped(rate)

  return (
    <main className="mx-auto flex min-h-screen max-w-xl lg:max-w-3xl flex-col p-6 pb-10">
      <header className="flex items-center justify-between">
        <button onClick={() => navigate('/taigi')} className="text-sm text-slate-500">
          ← 回台語首頁
        </button>
        <button
          onClick={() => navigate(`/taigi/${script.id}/listening`)}
          className="rounded-full bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700"
        >
          去聽 🎧
        </button>
      </header>

      <h1 className="mt-3 break-words text-xl font-bold">{script.title}</h1>
      <p className="mt-0.5 text-sm text-slate-400">
        第 {index + 1} / {lines.length} 句・已過關 {passed.size} 句
      </p>

      <div className="mt-2 flex gap-1">
        {lines.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              passed.has(i) ? 'bg-teal-500' : i === index ? 'bg-teal-200' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>

      <section className="mt-5 rounded-3xl bg-white p-6 shadow">
        <p className="break-words text-2xl font-bold leading-relaxed">{line.hanji}</p>
        {showTailo && <p className="mt-2 break-words text-teal-700">{line.tailo}</p>}
        {showZh && <p className="mt-2 break-words text-slate-500">{line.mandarin}</p>}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => setShowTailo(!showTailo)}
            aria-pressed={showTailo}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              showTailo ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {showTailo ? '隱藏台羅' : '顯示台羅'}
          </button>
          <button
            onClick={() => setShowZh(!showZh)}
            aria-pressed={showZh}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              showZh ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {showZh ? '隱藏華語' : '顯示華語'}
          </button>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={() => void playAiDemo()}
            disabled={phase === 'ai-reading' || phase === 'recording' || phase === 'scoring'}
            className="flex items-center gap-1.5 rounded-full bg-slate-100 px-4 py-2.5 font-semibold text-slate-600 disabled:opacity-40"
          >
            {phase === 'ai-reading' ? '🔊 播放中…' : '▶ 聽 AI 示範'}
          </button>
          <div className="min-w-0 flex-1">
            <SpeedPicker level={speedLevel} onChange={setSpeedLevel} showHint={false} compact />
          </div>
        </div>
        {clamped && (
          <p className="mt-1.5 text-xs text-amber-600">
            台語語音最快只到 {clampTaigiSpeed(rate)}x，已自動改用這個速度
          </p>
        )}

        <button
          onClick={() => void toggleRecording()}
          disabled={(!hasHeardDemo && phase !== 'recording') || phase === 'scoring'}
          className={`mt-5 w-full select-none rounded-xl py-4 text-lg font-bold text-white transition disabled:opacity-40 ${
            phase === 'recording' ? 'animate-pulse bg-red-500' : 'bg-teal-600'
          }`}
        >
          {phase === 'recording' ? '⏹ 唸完了，看分數' : phase === 'scoring' ? '分析中…' : '🎙 開始跟讀這句'}
        </button>
        {!hasHeardDemo && phase !== 'recording' && (
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
              <p className="text-xs text-slate-400">{TAIGI_PASS_THRESHOLD} 分過關</p>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              語調 {Math.round(result.pitchSim * 100)}% ・ 節奏 {Math.round(result.rhythmSim * 100)}% ・
              長度 {Math.round(result.durationSim * 100)}%
            </p>
            <p className="mt-1.5 text-sm font-semibold text-amber-700">
              ⓘ 比的是語調與節奏像不像，不是用字對不對——台語目前沒有可用的語音辨識
            </p>

            {/* 自己聽最準：分數只是參考，A/B 對照才是真回饋 */}
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void playAiDemo()}
                className="flex-1 rounded-xl bg-white py-2.5 text-sm font-semibold text-slate-600 shadow-sm"
              >
                🔊 聽 AI
              </button>
              <button
                onClick={playMyClip}
                disabled={!myClipUrl}
                className="flex-1 rounded-xl bg-white py-2.5 text-sm font-semibold text-slate-600 shadow-sm disabled:opacity-40"
              >
                🎧 聽自己
              </button>
            </div>

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
                  {index + 1 < lines.length ? '下一句 →' : '完成 🎉'}
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
