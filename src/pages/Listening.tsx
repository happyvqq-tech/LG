import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { speak, speakSequence, splitSentences, stopSpeaking, ttsSupported } from '../lib/speech'
import { updateTaskJson } from '../lib/taskService'
import TaskNav from '../components/TaskNav'
import SpeedPicker from '../components/SpeedPicker'
import VoicePicker from '../components/VoicePicker'
import { useSpeechRate } from '../lib/useSpeechRate'

export default function Listening() {
  const navigate = useNavigate()
  const { task, setTask, loading } = useActiveTask()
  const sentences = useMemo(
    () => splitSentences(task?.task_json.listening_script ?? ''),
    [task],
  )
  const lang = task?.language ?? '英文'

  const { level: speedLevel, rate, setLevel: setSpeedLevel } = useSpeechRate()
  const [sentenceMode, setSentenceMode] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [index, setIndex] = useState(0)
  const [listenCount, setListenCount] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [showVoicePicker, setShowVoicePicker] = useState(false)
  const sessionRef = useRef(0)
  const persistedDoneRef = useRef(false)

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
      if (onlyOne) {
        setIndex(start)
        await speak(sentences[start], lang, rate)
        return
      }
      // 整段用 speakSequence 一次排進佇列，句與句之間才不會有停頓
      // （之前逐句 await，每句之間都聽得出空隙）
      await speakSequence(sentences.slice(start), lang, rate, (i) => {
        if (sessionRef.current === session) setIndex(start + i)
      })
      if (sessionRef.current !== session) return
      // 完整聽完一輪
      setListenCount((c) => c + 1)
      setIndex(0)
    } catch (e: unknown) {
      setErrorMsg((e as Error).message)
    } finally {
      if (sessionRef.current === session) setPlaying(false)
    }
  }

  const canProceed = listenCount >= 2 || task?.task_json.listening_done === true

  // 聽滿 2 次要存進 task_json，不然離開這頁再回來（或直接跳去別的分頁）進度就會歸零，
  // 「聽兩次才能進閱讀」這個關卡就形同虛設（見稽核報告 P0-2）
  useEffect(() => {
    if (!task || !canProceed || task.task_json.listening_done || persistedDoneRef.current) return
    persistedDoneRef.current = true
    void updateTaskJson(task, { listening_done: true }).then(setTask).catch(() => undefined)
  }, [task, canProceed, setTask])

  if (loading || !task) return <p className="p-10 text-center text-slate-400">載入中…</p>

  return (
    <main className="mx-auto flex min-h-screen max-w-xl lg:max-w-3xl flex-col p-6 pb-10">
      <TaskNav current="listening" />
      <header>
        <p className="text-sm font-semibold text-teal-700">第一關・聽力</p>
        <h1 className="mt-1 break-words text-2xl font-bold">{task.task_json.scenario_title}</h1>
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

        <div className="mt-6 w-full">
          <p className="text-sm font-semibold text-slate-600">語速</p>
          <div className="mt-1.5">
            <SpeedPicker
              level={speedLevel}
              onChange={(lv) => {
                stop() // 換速度就停下重播，免得聽到一半速度跳掉
                setSpeedLevel(lv)
              }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
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
            <button
              onClick={() => {
                stop()
                setShowVoicePicker(true)
              }}
              className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600"
            >
              🗣️ 換發音
            </button>
          </div>
        </div>

        <button
          onClick={() => {
            stop()
            navigate('/listening-cloze')
          }}
          className="mt-4 rounded-full bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700"
        >
          📝 換成挖空聽寫測驗（額外加練）
        </button>

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

      {showVoicePicker && (
        <VoicePicker language={lang} onClose={() => setShowVoicePicker(false)} />
      )}
    </main>
  )
}
