// 泛聽播放器：整段連續播，原文預設藏起來
//
// 原文預設隱藏是刻意的。泛聽一旦邊看邊聽就退化成朗讀跟讀，練的是解碼而不是
// 聽力自動化——眼睛永遠比耳朵快，只要文字在畫面上，耳朵就會偷懶。
// 真的聽不下去再翻開，那時它是救援不是預設。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { getExtensive } from '../lib/extensiveService'
import { speakSequence, splitSentences, stopSpeaking, ttsSupported } from '../lib/speech'
import { useSpeechRate } from '../lib/useSpeechRate'
import { logActivity } from '../lib/streakService'
import SpeedPicker from '../components/SpeedPicker'
import VoicePicker from '../components/VoicePicker'
import type { ExtensiveListen } from '../lib/types'

export default function ExtensivePlayer() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { profile } = useProfile()
  const { level: speedLevel, rate, setLevel: setSpeedLevel } = useSpeechRate()

  const [item, setItem] = useState<ExtensiveListen | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [playing, setPlaying] = useState(false)
  const [index, setIndex] = useState(0)
  const [showText, setShowText] = useState(false)
  const [showVoicePicker, setShowVoicePicker] = useState(false)
  const [finishedOnce, setFinishedOnce] = useState(false)
  const sessionRef = useRef(0)
  const loggedRef = useRef(false)

  useEffect(() => {
    if (!profile || !id) return
    let alive = true
    getExtensive(id, profile.id)
      .then((x) => {
        if (!alive) return
        if (!x) navigate('/extensive', { replace: true })
        else setItem(x)
      })
      .catch((e: unknown) => {
        if (alive) setErrorMsg(`讀取失敗：${String((e as Error).message)}`)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [profile, id, navigate])

  useEffect(() => {
    return () => {
      sessionRef.current++
      stopSpeaking()
    }
  }, [])

  const sentences = useMemo(() => splitSentences(item?.script ?? ''), [item])
  const lang = item?.language ?? '英文'

  function stop() {
    sessionRef.current++
    stopSpeaking()
    setPlaying(false)
  }

  /** 從第 from 句開始播到最後。中途停掉再按播放會從目前這句接續，不用從頭 */
  async function play(from = index) {
    stop()
    const session = ++sessionRef.current
    setPlaying(true)
    setErrorMsg('')
    try {
      await speakSequence(sentences.slice(from), lang, rate, (i) => {
        if (sessionRef.current === session) setIndex(from + i)
      })
      if (sessionRef.current !== session) return
      setFinishedOnce(true)
      setIndex(0)
      if (profile && !loggedRef.current) {
        loggedRef.current = true
        void logActivity(profile.id).catch(() => undefined)
      }
    } catch (e: unknown) {
      if (sessionRef.current === session) setErrorMsg((e as Error).message)
    } finally {
      if (sessionRef.current === session) setPlaying(false)
    }
  }

  if (loading) return <p className="p-10 text-center text-slate-400">載入中…</p>
  if (!item) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p className="rounded-xl bg-red-50 p-4 text-red-600">{errorMsg || '找不到這篇泛聽材料'}</p>
        <button
          onClick={() => navigate('/extensive')}
          className="mt-4 w-full rounded-xl bg-slate-100 py-3 font-semibold text-slate-600"
        >
          回泛聽列表
        </button>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl lg:max-w-3xl flex-col p-6 pb-10">
      <button
        onClick={() => {
          stop()
          navigate('/extensive')
        }}
        className="-ml-2 flex items-center gap-1 rounded-full px-2 text-sm font-semibold text-slate-500 active:bg-slate-100"
      >
        ← 泛聽列表
      </button>

      <header className="mt-2">
        <p className="text-sm font-semibold text-teal-700">
          泛聽・{item.language}
          {item.level ? `・${item.level}` : ''}
        </p>
        <h1 className="mt-1 break-words text-2xl font-bold">{item.title}</h1>
      </header>

      {!ttsSupported() && (
        <p className="mt-5 rounded-xl bg-amber-50 p-4 text-amber-700">
          此瀏覽器不支援語音播放，可以按「顯示原文」用讀的。
        </p>
      )}

      <section className="mt-6 flex flex-1 flex-col items-center rounded-3xl bg-white p-8 shadow">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-teal-50 text-4xl">
          🎧
        </div>

        <div className="mt-4 w-full max-w-xs">
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-teal-500 transition-all"
              style={{ width: `${((index + 1) / Math.max(sentences.length, 1)) * 100}%` }}
            />
          </div>
          <p className="mt-1.5 text-center text-xs text-slate-400">
            第 {index + 1} / {sentences.length} 句
            {finishedOnce && ' ・已完整聽過一遍'}
          </p>
        </div>

        <button
          onClick={() => (playing ? stop() : void play())}
          className="mt-6 h-20 w-20 rounded-full bg-teal-600 text-3xl text-white active:scale-95"
          aria-label={playing ? '暫停' : '播放'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <p className="mt-2 text-xs text-slate-400">
          {playing ? '播放中，可以把手機放旁邊' : '從目前這句開始播'}
        </p>

        {index > 0 && !playing && (
          <button
            onClick={() => {
              setIndex(0)
              void play(0)
            }}
            className="mt-3 rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600"
          >
            ⟲ 從頭再聽一次
          </button>
        )}

        <button
          onClick={() => setShowText(!showText)}
          className={`mt-5 rounded-full px-4 py-2 text-sm font-semibold ${
            showText ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
          }`}
        >
          {showText ? '隱藏原文' : '真的聽不下去，顯示原文'}
        </button>

        {showText && (
          <div className="mt-4 w-full">
            {sentences.map((s, i) => (
              <p
                key={i}
                className={`rounded px-2 py-1 leading-relaxed ${
                  i === index ? 'bg-teal-50 font-semibold' : ''
                }`}
              >
                {s}
              </p>
            ))}
          </div>
        )}

        <div className="mt-6 w-full border-t border-slate-100 pt-5">
          <p className="text-sm font-semibold text-slate-600">語速</p>
          <div className="mt-1.5">
            <SpeedPicker
              level={speedLevel}
              onChange={(lv) => {
                stop()
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

        {errorMsg && <p className="mt-4 text-center text-red-600">{errorMsg}</p>}
      </section>

      <p className="mt-4 text-center text-xs leading-relaxed text-slate-400">
        聽不懂的地方直接跳過就好。泛聽練的是「跟上速度」，不是「聽懂每個字」——
        同一篇多聽幾次比查完每個生字有用得多。
      </p>

      {showVoicePicker && (
        <VoicePicker language={lang} onClose={() => setShowVoicePicker(false)} />
      )}
    </main>
  )
}
