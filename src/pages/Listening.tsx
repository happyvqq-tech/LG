import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { speak, splitSentences, stopSpeaking, ttsSupported } from '../lib/speech'

export default function Listening() {
  const navigate = useNavigate()
  const { task, loading } = useActiveTask()
  const sentences = useMemo(
    () => splitSentences(task?.task_json.listening_script ?? ''),
    [task],
  )
  const lang = task?.language ?? '英文'

  const [rate, setRate] = useState(1)
  const [sentenceMode, setSentenceMode] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [index, setIndex] = useState(0)
  const [listenCount, setListenCount] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const sessionRef = useRef(0)

  // 離開頁面時停止播放
  useEffect(() => {
    return () => {
      sessionRef.current++
      stopSpeaking()
    }
  }, [])

  function stop() {
    sessionRef.current++
    stopSpeaking()
    setPlaying(false)
  }

  /** 從第 start 句開始連續播（onlyOne=true 時只播一句） */
  async function playFrom(start: number, onlyOne: boolean) {
    stop()
    const session = ++sessionRef.current
    setPlaying(true)
    setErrorMsg('')
    try {
      for (let i = start; i < sentences.length; i++) {
        if (sessionRef.current !== session) return
        setIndex(i)
        await speak(sentences[i], lang, rate)
        if (sessionRef.current !== session) return
        if (onlyOne) break
        if (i === sentences.length - 1) {
          // 完整聽完一輪
          setListenCount((c) => c + 1)
          setIndex(0)
        }
      }
    } catch (e: unknown) {
      setErrorMsg((e as Error).message)
    } finally {
      if (sessionRef.current === session) setPlaying(false)
    }
  }

  if (loading || !task) return <p className="p-10 text-center text-slate-400">載入中…</p>

  const canProceed = listenCount >= 2

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col p-6 pb-10">
      <header className="pt-2">
        <p className="text-sm font-semibold text-teal-700">第一關・聽力</p>
        <h1 className="mt-1 text-2xl font-bold">{task.task_json.scenario_title}</h1>
        <p className="mt-1 text-slate-500">{task.task_json.scenario_desc}</p>
      </header>

      {!ttsSupported() && (
        <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-700">
          此瀏覽器不支援語音播放，請改用手機的 Chrome 或 Edge。
        </p>
      )}

      {/* 不顯示聽力稿文字，只給播放控制 */}
      <section className="mt-8 flex flex-1 flex-col items-center justify-center rounded-3xl bg-white p-8 shadow">
        <div className="flex h-28 w-28 items-center justify-center rounded-full bg-teal-50 text-5xl">
          🎧
        </div>
        <p className="mt-4 text-slate-500">
          {playing ? `播放中：第 ${index + 1} / ${sentences.length} 句` : `共 ${sentences.length} 句`}
        </p>
        <p className="mt-1 text-sm text-slate-400">已完整聽 {listenCount} 次（聽 2 次解鎖閱讀）</p>

        <div className="mt-6 flex items-center gap-4">
          {playing ? (
            <button
              onClick={stop}
              className="h-16 w-16 rounded-full bg-slate-200 text-2xl active:scale-95"
              aria-label="暫停"
            >
              ⏸
            </button>
          ) : (
            <button
              onClick={() => void playFrom(index, sentenceMode)}
              className="h-16 w-16 rounded-full bg-teal-600 text-2xl text-white active:scale-95"
              aria-label="播放"
            >
              ▶
            </button>
          )}
          <button
            onClick={() => void playFrom(0, false)}
            className="rounded-full bg-slate-100 px-5 py-3 font-semibold text-slate-600 active:scale-95"
          >
            重播
          </button>
        </div>

        {sentenceMode && (
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={() => void playFrom(Math.max(0, index - 1), true)}
              className="rounded-full bg-slate-100 px-5 py-2.5 font-semibold text-slate-600"
            >
              ← 上一句
            </button>
            <button
              onClick={() => void playFrom(Math.min(sentences.length - 1, index + 1), true)}
              className="rounded-full bg-slate-100 px-5 py-2.5 font-semibold text-slate-600"
            >
              下一句 →
            </button>
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <button
            onClick={() => setRate(rate === 1 ? 0.75 : 1)}
            className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600"
          >
            語速 {rate === 1 ? '1x' : '0.75x'}
          </button>
          <button
            onClick={() => {
              stop()
              setSentenceMode(!sentenceMode)
            }}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              sentenceMode ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            分句播放{sentenceMode ? '中' : ''}
          </button>
        </div>

        {errorMsg && <p className="mt-4 text-center text-red-600">{errorMsg}</p>}
      </section>

      <button
        onClick={() => {
          stop()
          navigate('/reading')
        }}
        disabled={!canProceed}
        className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-40"
      >
        {canProceed ? '我聽完了 → 進入閱讀' : '請先完整聽 2 次'}
      </button>
    </main>
  )
}
