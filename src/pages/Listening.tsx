import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { speak, speakSequence, splitSentences, stopSpeaking, ttsSupported } from '../lib/speech'
import { updateTaskJson } from '../lib/taskService'
import { ensureListeningTranslation } from '../lib/translationService'
import { ensureReadingAid } from '../lib/readingAidService'
import { READING_AID_LABEL, readingAidSupported } from '../lib/prompts/readingAid'
import ReadingAidText, { replacesOriginal } from '../components/ReadingAidText'
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
  const [showText, setShowText] = useState(false)
  const [showZh, setShowZh] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState('')
  const [showAid, setShowAid] = useState(false)
  const [aiding, setAiding] = useState(false)
  const [aidError, setAidError] = useState('')
  const sessionRef = useRef(0)
  const persistedDoneRef = useRef(false)
  /**
   * 逐句聽的時候，把聽過的句子記下來；整篇每一句都聽過就等於完整聽了一輪。
   * 沒有這個的話，逐句聽（改版後的主要用法）永遠不會累積次數。
   * 用 ref 不用 state：它不參與畫面渲染，而且放在 setState 的 updater 裡
   * 累加會在 StrictMode 下被呼叫兩次而重複計數。
   */
  const heardRef = useRef<Set<number>>(new Set())

  const translations = task?.task_json.listening_translation ?? null
  const aids = task?.task_json.listening_reading_aid ?? null
  /** 英文沒有讀音輔助（見 prompts/readingAid.ts 的說明），按鈕就不該出現 */
  const aidLang = readingAidSupported(lang) ? lang : null

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
      if (sessionRef.current !== session) return
      // 逐句聽也要算進度：整篇每一句都聽過就等於完整聽了一輪
      heardRef.current.add(i)
      if (sentences.length > 0 && heardRef.current.size >= sentences.length) {
        heardRef.current = new Set() // 歸零，下一輪重新累積
        setListenCount((c) => c + 1)
      }
    } catch (e: unknown) {
      if (sessionRef.current === session) setErrorMsg((e as Error).message)
    } finally {
      if (sessionRef.current === session) setPlaying(false)
    }
  }

  /** 整段從頭到尾連續播一輪（不停頓） */
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
      heardRef.current = new Set() // 整段播完就是完整一輪，逐句的累積歸零重來
      setIndex(0)
    } catch (e: unknown) {
      setErrorMsg((e as Error).message)
    } finally {
      if (sessionRef.current === session) setPlaying(false)
    }
  }

  async function toggleShowAid() {
    if (showAid) {
      setShowAid(false)
      return
    }
    setShowAid(true)
    // 日文的假名要標在漢字上，所以打開讀音就得同時看得到原文
    if (!showText) setShowText(true)
    if (!task || aids) return
    setAiding(true)
    setAidError('')
    try {
      const result = await ensureReadingAid(task)
      setTask(result.task)
    } catch (e: unknown) {
      setAidError(`讀音標註失敗：${String((e as Error).message)}`)
    } finally {
      setAiding(false)
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

  /**
   * 聽夠了沒——只用來顯示建議，不拿來擋人。
   *
   * 之前這個值會讓「進入閱讀」的按鈕變灰，但四關本來就可以自由跳（見 TaskNav
   * 的說明），把按鈕鎖起來只會做出一條死路：逐句聽是改版後的主要用法，
   * 而逐句聽根本不會累積次數，等於整篇聽完了按鈕還是灰的。
   */
  const listenedEnough = listenCount >= 2 || task?.task_json.listening_done === true

  // 聽滿 2 次要存進 task_json，離開這頁再回來才不會從頭算
  useEffect(() => {
    if (!task || !listenedEnough || task.task_json.listening_done || persistedDoneRef.current) return
    persistedDoneRef.current = true
    void updateTaskJson(task, { listening_done: true }).then(setTask).catch(() => undefined)
  }, [task, listenedEnough, setTask])

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

      {/* 一句一句聽：原文與中文翻譯預設都藏起來（先用耳朵聽），需要時各自可以展開 */}
      <section className="mt-8 flex flex-1 flex-col items-center justify-center rounded-3xl bg-white p-8 shadow">
        <div className="flex h-28 w-28 items-center justify-center rounded-full bg-teal-50 text-5xl">
          🎧
        </div>
        <p className="mt-4 font-semibold text-slate-600">
          第 {index + 1} / {sentences.length} 句
        </p>

        {showText &&
          (showAid && aidLang && aids?.[index] && replacesOriginal(aidLang) ? (
            // 日文：假名標在漢字上，等於連原句一起呈現，不必再印一次純文字
            <ReadingAidText
              language={aidLang}
              aid={aids[index]}
              className="mt-3 text-center text-lg font-semibold leading-loose"
            />
          ) : (
            <p className="mt-3 text-center text-lg font-semibold leading-relaxed">
              {sentences[index]}
            </p>
          ))}

        {/* 韓文：實際發音是「同一句的另一種寫法」，要跟原句上下對照才看得出音變 */}
        {showAid && aidLang && aids?.[index] && !replacesOriginal(aidLang) && (
          <ReadingAidText
            language={aidLang}
            aid={aids[index]}
            className="mt-2 text-center text-lg leading-relaxed text-amber-900"
          />
        )}

        {showAid && aiding && <p className="mt-2 text-sm text-slate-400">標註讀音中…</p>}
        {aidError && <p className="mt-2 text-sm text-red-600">{aidError}</p>}

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

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => setShowText(!showText)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              showText ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {showText ? '隱藏原文' : '顯示原文'}
          </button>
          <button
            onClick={() => void toggleShowZh()}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              showZh ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {showZh ? '隱藏中文' : '顯示中文'}
          </button>
          {aidLang && (
            <button
              onClick={() => void toggleShowAid()}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                showAid ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {showAid ? READING_AID_LABEL[aidLang].hide : READING_AID_LABEL[aidLang].show}
            </button>
          )}
        </div>

        <div className="mt-6 w-full border-t border-slate-100 pt-5 text-center">
          <button
            onClick={() => void playFullPass()}
            disabled={playing}
            className="rounded-full bg-teal-50 px-5 py-2.5 text-sm font-semibold text-teal-700 disabled:opacity-50"
          >
            🎧 整段從頭連續播放
          </button>
          <p className="mt-1.5 text-xs text-slate-400">
            已完整聽 {listenCount} 次（逐句把每一句都聽過，也算完整一輪）
          </p>
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
        className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white"
      >
        我聽完了 → 進入閱讀
      </button>
      {!listenedEnough && (
        <p className="mt-1.5 text-center text-xs text-slate-400">
          建議完整聽 2 次再往下，不過你隨時可以直接進閱讀
        </p>
      )}

      {showVoicePicker && (
        <VoicePicker language={lang} onClose={() => setShowVoicePicker(false)} />
      )}
    </main>
  )
}
