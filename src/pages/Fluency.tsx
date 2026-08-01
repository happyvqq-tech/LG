// 流利度訓練（4/3/2）：同一個話題連講三次，時間一次比一次短
//
// 題目刻意用「今天剛練完的情境」——流利度訓練的前提是內容已經會了，
// 拿新題目來練就變成又在學新東西，那是另一股的事（見 lib/fluencyRounds.ts）。
//
// 這頁不批改、不糾錯。中途糾正會把注意力拉回準確度，那正好是流利度訓練
// 要避開的——這一輪的目標只有一個：講得比上一輪快。
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { HoldToTalkRecognizer, sttSupported } from '../lib/speech'
import {
  countWords,
  FLUENCY_ROUNDS,
  speedGain,
  wordsPerMinute,
  type RoundResult,
} from '../lib/fluencyRounds'
import { logActivity } from '../lib/streakService'
import TaskNav from '../components/TaskNav'

type Phase = 'ready' | 'speaking' | 'between' | 'done'

export default function Fluency() {
  const navigate = useNavigate()
  const { task, loading } = useActiveTask()

  const [phase, setPhase] = useState<Phase>('ready')
  const [roundIndex, setRoundIndex] = useState(0)
  const [remaining, setRemaining] = useState(FLUENCY_ROUNDS[0].seconds)
  const [results, setResults] = useState<RoundResult[]>([])
  const [errorMsg, setErrorMsg] = useState('')
  const [showChunks, setShowChunks] = useState(true)

  const recognizerRef = useRef<HoldToTalkRecognizer | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const loggedRef = useRef(false)

  const round = FLUENCY_ROUNDS[roundIndex]
  const lang = task?.language ?? '英文'
  /** 沒有語音辨識就退成純計時器：算不出字數，但時間壓力這個核心機制還在 */
  const canCount = sttSupported()

  function clearTimer() {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      clearTimer()
      recognizerRef.current?.cancel()
    }
  }, [])

  function start() {
    setErrorMsg('')
    setRemaining(round.seconds)
    setPhase('speaking')

    if (canCount) {
      try {
        const rec = new HoldToTalkRecognizer()
        recognizerRef.current = rec
        rec.start(lang)
      } catch (e: unknown) {
        // 辨識起不來就繼續當計時器用，不要因此讓人練不成
        recognizerRef.current = null
        setErrorMsg(`${String((e as Error).message)}（改用純計時，這輪不計字數）`)
      }
    }

    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearTimer()
          void finishRound()
          return 0
        }
        return r - 1
      })
    }, 1000)
  }

  async function finishRound() {
    clearTimer()
    let words = 0
    try {
      const transcript = (await recognizerRef.current?.stop()) ?? ''
      words = countWords(transcript, lang)
    } catch {
      // 辨識收尾失敗就當作這輪沒計到字數，不影響流程
    }
    recognizerRef.current = null

    const result: RoundResult = {
      round: round.index,
      seconds: round.seconds,
      words,
      wpm: wordsPerMinute(words, round.seconds),
    }
    const next = [...results, result]
    setResults(next)

    if (roundIndex + 1 >= FLUENCY_ROUNDS.length) {
      setPhase('done')
      if (task && !loggedRef.current) {
        loggedRef.current = true
        void logActivity(task.profile_id).catch(() => undefined)
      }
      return
    }
    setPhase('between')
  }

  function nextRound() {
    const i = roundIndex + 1
    setRoundIndex(i)
    setRemaining(FLUENCY_ROUNDS[i].seconds)
    setPhase('ready')
  }

  function restart() {
    setRoundIndex(0)
    setRemaining(FLUENCY_ROUNDS[0].seconds)
    setResults([])
    setPhase('ready')
    loggedRef.current = false
  }

  if (loading || !task) return <p className="p-10 text-center text-slate-400">載入中…</p>

  const t = task.task_json
  const gain = speedGain(results)

  return (
    <main className="mx-auto flex min-h-screen max-w-xl lg:max-w-3xl flex-col p-6 pb-10">
      <TaskNav current="speaking" />
      <header>
        <p className="text-sm font-semibold text-teal-700">額外練習・流利度</p>
        <h1 className="mt-1 text-2xl font-bold">同一段話，講三次</h1>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">
          內容不變，時間一次比一次短。這個練習
          <span className="font-semibold text-slate-700">不學新東西</span>
          ——目標只有一個：把已經會的講得更快、更順。
        </p>
      </header>

      {/* 題目：今天剛練完的情境 */}
      <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <p className="text-xs font-semibold text-slate-400">題目</p>
        <p className="mt-1 font-bold">{t.scenario_title}</p>
        <p className="mt-1 text-sm text-slate-600">
          用{task.language}講一遍：這個情境發生什麼事、你的看法或你會怎麼做。
        </p>
        {t.chunks.length > 0 && (
          <>
            <button
              onClick={() => setShowChunks(!showChunks)}
              className="mt-3 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600"
            >
              {showChunks ? '收起語塊提示' : '看語塊提示'}
            </button>
            {showChunks && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {t.chunks.map((c, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700"
                  >
                    {c.text}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {phase !== 'done' && (
        <section className="mt-5 flex flex-1 flex-col items-center justify-center rounded-3xl bg-white p-8 shadow">
          <p className="text-sm font-semibold text-teal-700">
            第 {round.index} / {FLUENCY_ROUNDS.length} 輪・{round.seconds} 秒
          </p>

          <p
            className={`mt-3 text-6xl font-bold tabular-nums ${
              phase === 'speaking' && remaining <= 10 ? 'text-red-500' : 'text-slate-800'
            }`}
          >
            {Math.floor(remaining / 60)}:{`${remaining % 60}`.padStart(2, '0')}
          </p>

          <p className="mt-3 max-w-sm text-center text-sm leading-relaxed text-slate-500">
            {round.hint}
          </p>

          {phase === 'ready' && (
            <button
              onClick={start}
              className="mt-6 rounded-full bg-teal-600 px-10 py-4 text-lg font-bold text-white active:scale-95"
            >
              {round.index === 1 ? '開始' : `開始第 ${round.index} 輪`}
            </button>
          )}

          {phase === 'speaking' && (
            <>
              <p className="mt-6 flex items-center gap-2 font-semibold text-red-500">
                <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
                講話中
              </p>
              <button
                onClick={() => void finishRound()}
                className="mt-4 rounded-full bg-slate-100 px-6 py-3 font-semibold text-slate-600"
              >
                講完了，提早結束
              </button>
            </>
          )}

          {phase === 'between' && (
            <>
              {canCount && results.length > 0 && (
                <p className="mt-4 text-center text-slate-600">
                  這輪講了 <span className="font-bold">{results[results.length - 1].words}</span> 個字，
                  約每分鐘 <span className="font-bold">{results[results.length - 1].wpm}</span> 字
                </p>
              )}
              <button
                onClick={nextRound}
                className="mt-6 rounded-full bg-teal-600 px-10 py-4 text-lg font-bold text-white active:scale-95"
              >
                下一輪（{FLUENCY_ROUNDS[roundIndex + 1].seconds} 秒）
              </button>
              <p className="mt-2 max-w-xs text-center text-xs text-slate-400">
                同樣的內容再講一次就好，不用換新的
              </p>
            </>
          )}

          {errorMsg && <p className="mt-4 text-center text-sm text-amber-600">{errorMsg}</p>}
          {!canCount && phase === 'ready' && (
            <p className="mt-4 max-w-xs text-center text-xs text-slate-400">
              這個瀏覽器不支援語音辨識，會用純計時進行——時間壓力才是這個練習的重點，
              字數只是附帶的參考
            </p>
          )}
        </section>
      )}

      {phase === 'done' && (
        <section className="mt-5 rounded-3xl bg-white p-6 shadow">
          <p className="text-center text-4xl">{gain !== null && gain > 0 ? '🚀' : '💪'}</p>
          <h2 className="mt-2 text-center text-xl font-bold">三輪完成</h2>

          {canCount ? (
            <>
              <div className="mt-5 grid gap-2">
                {results.map((r) => {
                  const max = Math.max(...results.map((x) => x.wpm), 1)
                  return (
                    <div key={r.round} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-sm font-semibold text-slate-500">
                        第 {r.round} 輪
                      </span>
                      <span className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span
                          className="block h-full rounded-full bg-teal-500"
                          style={{ width: `${(r.wpm / max) * 100}%` }}
                        />
                      </span>
                      <span className="w-24 shrink-0 text-right text-sm font-bold text-teal-700">
                        {r.wpm} 字/分
                      </span>
                    </div>
                  )
                })}
              </div>

              <p className="mt-4 text-center">
                {gain === null ? (
                  <span className="text-slate-500">這次沒有量到足夠的內容可以比較</span>
                ) : gain > 0 ? (
                  <span className="text-teal-700">
                    最後一輪比第一輪快了 <span className="text-2xl font-bold">{gain}%</span>
                  </span>
                ) : (
                  <span className="text-slate-500">
                    這次速度沒有明顯上升——第一次做通常會這樣，多做幾次就看得出來
                  </span>
                )}
              </p>
            </>
          ) : (
            <p className="mt-4 text-center text-slate-500">
              三輪都完成了。這個瀏覽器算不出字數，但你自己應該感覺得到第三輪比第一輪順。
            </p>
          )}

          <p className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-relaxed text-slate-500">
            這個練習的重點不是講得多好，是
            <span className="font-semibold text-slate-700">同樣的內容講得更快</span>
            。講得快代表這些字已經不需要現想了——那才是「會用」跟「知道」的差別。
          </p>

          <button
            onClick={restart}
            className="mt-5 w-full rounded-xl bg-teal-600 py-3.5 font-bold text-white"
          >
            再做一輪 4/3/2
          </button>
          <button
            onClick={() => navigate('/speaking')}
            className="mt-2 w-full rounded-xl bg-slate-100 py-3 font-semibold text-slate-600"
          >
            回口說選單
          </button>
        </section>
      )}
    </main>
  )
}
