// 台語聽力：逐句播放，漢字／台羅／華語三行可各自開關。
//
// 一句一句而不是整段播完（跟英日韓的 Listening 一致）：聽不懂的那一句可以
// 原地重聽，不用整段重來。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getTaigiScript, type TaigiScriptRow } from '../lib/taigiService'
import { loadTaigiVoice, clampTaigiSpeed, isTaigiSpeedClamped, type TaigiVoiceId } from '../lib/taigiVoice'
import { playTaigi, preloadTaigi, stopTaigi } from '../lib/taigiTts'
import { logActivity } from '../lib/streakService'
import { useProfile } from '../lib/profileContext'
import { useSpeechRate } from '../lib/useSpeechRate'
import SpeedPicker from '../components/SpeedPicker'

/**
 * 預先合成後面幾句，換句時不用等。
 * 只多抓一句：每合成一句就花一次雅婷的點數，抓太多而使用者中途離開就是白花錢
 * （已經聽過的句子由 Worker 端快取，重聽不再計費）。
 */
const PRELOAD_AHEAD = 1

export default function TaigiListening() {
  const { scriptId } = useParams<{ scriptId: string }>()
  const navigate = useNavigate()
  const { profile } = useProfile()
  const { level: speedLevel, rate, setLevel: setSpeedLevel } = useSpeechRate()

  const [script, setScript] = useState<TaigiScriptRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [showHanji, setShowHanji] = useState(true)
  const [showTailo, setShowTailo] = useState(false)
  const [showZh, setShowZh] = useState(false)
  const [heard, setHeard] = useState<Set<number>>(new Set())

  const voice = useMemo<TaigiVoiceId>(() => loadTaigiVoice(), [])
  const loggedRef = useRef(false)
  // 播放中連按「下一句」時，前一次的 playTaigi 還在 pending，回來時不該
  // 把已經換過的句子狀態蓋掉——用遞增的 session 編號擋掉過期的回呼
  const sessionRef = useRef(0)

  useEffect(() => {
    if (!scriptId) return
    setLoading(true)
    getTaigiScript(scriptId)
      .then((s) => {
        setScript(s)
        if (!s) setErrorMsg('找不到這份腳本')
      })
      .catch((e: unknown) => setErrorMsg(`讀取腳本失敗：${String((e as Error).message)}`))
      .finally(() => setLoading(false))
    return () => stopTaigi()
  }, [scriptId])

  const lines = script?.lines ?? []
  const line = lines[index]

  // 進到某一句就先把後面幾句合成好
  useEffect(() => {
    if (lines.length === 0) return
    preloadTaigi(
      lines.slice(index, index + 1 + PRELOAD_AHEAD).map((l) => l.hanji),
      voice,
      rate,
    )
  }, [lines, index, voice, rate])

  async function play(at = index) {
    const target = lines[at]
    if (!target) return
    const session = ++sessionRef.current
    setErrorMsg('')
    setPlaying(true)
    try {
      await playTaigi(target.hanji, voice, rate)
      if (sessionRef.current !== session) return
      setHeard((prev) => new Set(prev).add(at))
      if (!loggedRef.current && profile) {
        loggedRef.current = true
        void logActivity(profile.id).catch(() => undefined)
      }
    } catch (e: unknown) {
      if (sessionRef.current !== session) return
      const err = e as { friendlyMessage?: string; message: string }
      setErrorMsg(err.friendlyMessage ?? err.message)
    } finally {
      if (sessionRef.current === session) setPlaying(false)
    }
  }

  function goTo(next: number) {
    if (next < 0 || next >= lines.length) return
    stopTaigi()
    sessionRef.current++
    setPlaying(false)
    setIndex(next)
  }

  /** 從這句開始連續播到最後，中途按停止就收工 */
  async function playAll() {
    const session = ++sessionRef.current
    setErrorMsg('')
    setPlaying(true)
    try {
      for (let i = index; i < lines.length; i++) {
        if (sessionRef.current !== session) return
        setIndex(i)
        await playTaigi(lines[i].hanji, voice, rate)
        if (sessionRef.current !== session) return
        setHeard((prev) => new Set(prev).add(i))
      }
    } catch (e: unknown) {
      if (sessionRef.current !== session) return
      const err = e as { friendlyMessage?: string; message: string }
      setErrorMsg(err.friendlyMessage ?? err.message)
    } finally {
      if (sessionRef.current === session) setPlaying(false)
    }
  }

  function stop() {
    sessionRef.current++
    stopTaigi()
    setPlaying(false)
  }

  if (loading) return <p className="p-10 text-center text-slate-400">載入中…</p>
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

  const clamped = isTaigiSpeedClamped(rate)

  return (
    <main className="mx-auto flex min-h-screen max-w-xl lg:max-w-3xl flex-col p-6 pb-10">
      <header className="flex items-center justify-between">
        <button onClick={() => navigate('/taigi')} className="text-sm text-slate-500">
          ← 回台語首頁
        </button>
        <button
          onClick={() => navigate(`/taigi/${script.id}/shadowing`)}
          className="rounded-full bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700"
        >
          去跟讀 🗣️
        </button>
      </header>

      <h1 className="mt-3 break-words text-xl font-bold">{script.title}</h1>
      <p className="mt-0.5 text-sm text-slate-400">
        第 {index + 1} / {lines.length} 句・已聽 {heard.size} 句
      </p>

      <div className="mt-2 flex gap-1">
        {lines.map((_, i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              heard.has(i) ? 'bg-teal-500' : i === index ? 'bg-teal-200' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>

      {/* 顯示什麼由使用者決定：想純聽力就三個都關 */}
      <div className="mt-4 flex flex-wrap gap-2">
        {(
          [
            ['漢字', showHanji, setShowHanji],
            ['台羅', showTailo, setShowTailo],
            ['華語', showZh, setShowZh],
          ] as const
        ).map(([label, on, set]) => (
          <button
            key={label}
            onClick={() => set(!on)}
            aria-pressed={on}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
              on ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {on ? `隱藏${label}` : `顯示${label}`}
          </button>
        ))}
      </div>

      <section className="mt-4 rounded-3xl bg-white p-6 shadow">
        {showHanji ? (
          <p className="break-words text-2xl font-bold leading-relaxed">{line.hanji}</p>
        ) : (
          <p className="text-2xl font-bold text-slate-200">＿＿＿＿</p>
        )}
        {showTailo && <p className="mt-2 break-words text-teal-700">{line.tailo}</p>}
        {showZh && <p className="mt-2 break-words text-slate-500">{line.mandarin}</p>}

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => (playing ? stop() : void play())}
            className={`flex-1 rounded-xl py-3.5 text-lg font-bold text-white transition active:scale-95 ${
              playing ? 'bg-red-500' : 'bg-teal-600'
            }`}
          >
            {playing ? '⏹ 停止' : '▶ 播這句'}
          </button>
          <button
            onClick={() => void playAll()}
            disabled={playing}
            className="rounded-xl bg-slate-100 px-4 py-3.5 font-semibold text-slate-600 disabled:opacity-40"
          >
            ⏭ 連續播
          </button>
        </div>

        <div className="mt-4">
          <SpeedPicker level={speedLevel} onChange={setSpeedLevel} showHint={false} />
          {clamped && (
            <p className="mt-1.5 text-xs text-amber-600">
              台語語音最快只到 {clampTaigiSpeed(rate)}x，已自動改用這個速度
            </p>
          )}
        </div>

        {errorMsg && <p className="mt-3 text-center text-red-600">{errorMsg}</p>}
      </section>

      <div className="mt-4 flex gap-3">
        <button
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          className="flex-1 rounded-xl bg-white py-3 font-semibold text-slate-600 shadow-sm disabled:opacity-40"
        >
          ← 上一句
        </button>
        <button
          onClick={() => goTo(index + 1)}
          disabled={index + 1 >= lines.length}
          className="flex-1 rounded-xl bg-white py-3 font-semibold text-slate-600 shadow-sm disabled:opacity-40"
        >
          下一句 →
        </button>
      </div>

      {script.notes.length > 0 && (
        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <p className="text-sm font-bold text-slate-700">這段的台語詞</p>
          <ul className="mt-2 grid gap-2">
            {script.notes.map((n, i) => (
              <li key={i} className="text-sm">
                <span className="font-semibold">{n.word}</span>
                <span className="ml-2 text-teal-700">{n.tailo}</span>
                <span className="ml-2 text-slate-500">{n.zh}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
