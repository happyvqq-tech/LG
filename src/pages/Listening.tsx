import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { speak, speakSequence, splitSentences, stopSpeaking, ttsSupported } from '../lib/speech'
import { updateTaskJson } from '../lib/taskService'
import { ensureListeningTranslation } from '../lib/translationService'
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
  const [playing, setPlaying] = useState(false)
  const [index, setIndex] = useState(0)
  const [listenCount, setListenCount] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [showVoicePicker, setShowVoicePicker] = useState(false)
  const [showZh, setShowZh] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState('')
  const sessionRef = useRef(0)
  const persistedDoneRef = useRef(false)

  const translations = task?.task_json.listening_translation ?? null

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

  /** 只播目前這一句——一句一句聽，不要一次排一大段（見使用者回報） */
  async function playCurrent(i: number) {
    stop()
    const session = ++sessionRef.current
    setIndex(i)
    setPlaying(true)
    setErrorMsg('')
    try {
      await speak(sentences[i], lang, rate)
    } catch (e: unknown) {
      if (sessionRef.current === session) setErrorMsg((e as Error).message)
    } finally {
      if (sessionRef.current === session) setPlaying(false)
    }
  }

  /** 整段從頭到尾連續播一輪（不停頓），用來達成「聽兩次解鎖閱讀」 */
  async function playFullPass() {
    stop()
    const session = ++sessionRef.current
    setPlaying(true)
    setErrorMsg('')
    try {
      await speakSequence(sentences, lang, rate, (i) => {
        if (sessionRef.current === session) setIndex(i)
      })
      if (sessionRef.current !== session) return
      setListenCount((c) => c + 1)
      setIndex(0)
    } catch (e: unknown) {
      setErrorMsg((e as Error).message)
    } finally {
      if (sessionRef.current === session) setPlaying(false)
    }
  }

  async function toggleShowZh() {
    if (showZh) {
      setShowZh(false)
      return
    }
    setShowZh(true)
    if (!task || translations) return
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

      {/* 一句一句聽：不顯示英文原文，只給播放控制與可選的中文翻譯 */}
      <section className="mt-8 flex flex-1 flex-col items-center justify-center rounded-3xl bg-white p-8 shadow">
        <div className="flex h-28 w-28 items-center justify-center rounded-full bg-teal-50 text-5xl">
          🎧
        </div>
        <p className="mt-4 font-semibold text-slate-600">
          第 {index + 1} / {sentences.length} 句
        </p>

        {showZh && (
          <div className="mt-2 min-h-[1.5rem] text-center">
            {translating && <p className="text-sm text-slate-400">翻譯中…</p>}
            {translateError && <p className="text-sm text-red-600">{translateError}</p>}
            {translations && !translating && (
              <p className="text-teal-700">{translations[index]}</p>
            )}
          </div>
        )}

        <div className="mt-5 flex items-center gap-4">
          <button
            onClick={() => void playCurrent(Math.max(0, index - 1))}
            disabled={playing || index === 0}
            className="rounded-full bg-slate-100 px-4 py-2.5 font-semibold text-slate-600 disabled:opacity-30"
          >
            ← 上一句
          </button>
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
              onClick={() => void playCurrent(index)}
              className="h-16 w-16 rounded-full bg-teal-600 text-2xl text-white active:scale-95"
              aria-label="播放這句"
            >
              ▶
            </button>
          )}
          <button
            onClick={() => void playCurrent(Math.min(sentences.length - 1, index + 1))}
            disabled={playing || index === sentences.length - 1}
            className="rounded-full bg-slate-100 px-4 py-2.5 font-semibold text-slate-600 disabled:opacity-30"
          >
            下一句 →
          </button>
        </div>

        <button
          onClick={() => void toggleShowZh()}
          className={`mt-4 rounded-full px-4 py-2 text-sm font-semibold ${
            showZh ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {showZh ? '隱藏中文' : '顯示中文'}
        </button>

        <div className="mt-6 w-full border-t border-slate-100 pt-5 text-center">
          <button
            onClick={() => void playFullPass()}
            disabled={playing}
            className="rounded-full bg-teal-50 px-5 py-2.5 text-sm font-semibold text-teal-700 disabled:opacity-50"
          >
            🎧 整段從頭連續播放
          </button>
          <p className="mt-1.5 text-xs text-slate-400">已完整聽 {listenCount} 次（聽 2 次解鎖閱讀）</p>
        </div>

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
          <button
            onClick={() => {
              stop()
              setShowVoicePicker(true)
            }}
            className="mt-3 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600"
          >
            🗣️ 換發音
          </button>
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
