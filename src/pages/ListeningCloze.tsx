// 聽力挖空聽寫：參考希平方的「聽打＋填空」精聽法。
// 聽一句（或一小段）之後，把原文裡挖掉的關鍵字聽寫回去，可無限次重播。
import { useMemo, useRef, useState } from 'react'
import { useActiveTask } from '../lib/useActiveTask'
import { speak, splitSentences, stopSpeaking, ttsSupported } from '../lib/speech'
import { buildClozeSession, type ClozeRound } from '../lib/clozeRules'
import { judgeAnswer, scoreFor, VERDICT_LABELS, type Verdict } from '../lib/quizGrading'
import { logActivity } from '../lib/streakService'
import TaskNav from '../components/TaskNav'
import SpeedPicker from '../components/SpeedPicker'
import { useSpeechRate } from '../lib/useSpeechRate'

type Mode = 'sentence' | 'paragraph'

export default function ListeningCloze() {
  const { task, loading } = useActiveTask()
  const sentences = useMemo(() => splitSentences(task?.task_json.listening_script ?? ''), [task])
  const lang = task?.language ?? '英文'
  const { level: speedLevel, rate, setLevel: setSpeedLevel } = useSpeechRate()

  const [mode, setMode] = useState<Mode>('sentence')
  const rounds = useMemo(() => buildClozeSession(sentences, lang, mode), [sentences, lang, mode])

  const [roundIndex, setRoundIndex] = useState(0)
  const [inputs, setInputs] = useState<string[]>([])
  const [verdicts, setVerdicts] = useState<Verdict[] | null>(null)
  const [playing, setPlaying] = useState(false)
  const [scores, setScores] = useState<number[]>([])
  const loggedRef = useRef(false)

  const round: ClozeRound | undefined = rounds[roundIndex]
  const finished = rounds.length > 0 && roundIndex >= rounds.length

  function changeMode(next: Mode) {
    stopSpeaking()
    setMode(next)
    setRoundIndex(0)
    setInputs([])
    setVerdicts(null)
    setScores([])
    loggedRef.current = false
  }

  async function play() {
    if (!round) return
    stopSpeaking()
    setPlaying(true)
    try {
      await speak(round.sourceText, lang, rate)
    } catch {
      // 播放失敗不擋流程，使用者可以按重播再試
    } finally {
      setPlaying(false)
    }
  }

  function setInput(i: number, value: string) {
    setInputs((prev) => {
      const next = [...prev]
      next[i] = value
      return next
    })
  }

  function submit() {
    if (!round) return
    const vs = round.answers.map((ans, i) => judgeAnswer(inputs[i] ?? '', ans))
    setVerdicts(vs)
    const score = Math.round(
      (vs.reduce((sum, v) => sum + scoreFor(v, false), 0) / vs.length) * 100,
    )
    setScores((prev) => [...prev, score])
  }

  function next() {
    stopSpeaking()
    if (roundIndex + 1 >= rounds.length) {
      setRoundIndex(rounds.length)
      if (!loggedRef.current && task) {
        loggedRef.current = true
        void logActivity(task.profile_id).catch(() => undefined)
      }
    } else {
      setRoundIndex((i) => i + 1)
      setInputs([])
      setVerdicts(null)
    }
  }

  if (loading || !task) return <p className="p-10 text-center text-slate-400">載入中…</p>

  if (!ttsSupported()) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
        <TaskNav current="listening" />
        <p className="rounded-xl bg-amber-50 p-4 text-amber-700">此瀏覽器不支援語音播放，請改用 Chrome 或 Edge。</p>
      </main>
    )
  }

  if (rounds.length === 0) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
        <TaskNav current="listening" />
        <p className="rounded-xl bg-amber-50 p-4 text-amber-700">這篇聽力稿太短，找不到適合挖空的關鍵字。</p>
      </main>
    )
  }

  if (finished) {
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    return (
      <main className="mx-auto flex min-h-screen max-w-xl lg:max-w-3xl flex-col p-6">
        <TaskNav current="listening" />
        <div className="mt-8 rounded-3xl bg-white p-8 text-center shadow">
          <p className="text-4xl">{avg >= 80 ? '🏆' : '💪'}</p>
          <p className="mt-3 text-xl font-bold">挖空聽寫完成！平均 {avg} 分</p>
          <p className="mt-1 text-slate-500">共練習了 {scores.length} 題</p>
          <button
            onClick={() => changeMode(mode)}
            className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white"
          >
            再練一次
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl lg:max-w-3xl flex-col p-6 pb-10">
      <TaskNav current="listening" />
      <header>
        <p className="text-sm font-semibold text-teal-700">📝 挖空聽寫（額外練習）</p>
        <h1 className="mt-1 text-xl font-bold">{task.task_json.scenario_title}</h1>
        <p className="mt-1 text-sm text-slate-400">
          第 {roundIndex + 1} / {rounds.length} 題
        </p>
      </header>

      <div className="mt-3 flex gap-2">
        {(['sentence', 'paragraph'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => changeMode(m)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              mode === m ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {m === 'sentence' ? '單句' : '短段落'}
          </button>
        ))}
      </div>

      <section className="mt-4 rounded-3xl bg-white p-6 shadow">
        <div className="flex items-center gap-3">
          <button
            onClick={() => void play()}
            disabled={playing}
            className="flex items-center gap-1.5 rounded-full bg-teal-600 px-4 py-2.5 font-semibold text-white disabled:opacity-60"
          >
            {playing ? '🔊 播放中…' : '▶ 播放'}
          </button>
          <div className="min-w-0 flex-1">
            <SpeedPicker level={speedLevel} onChange={setSpeedLevel} showHint={false} compact />
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-400">可以重複聽任意次數，聽到什麼就填什麼</p>

        <div className="mt-5 flex flex-wrap items-center gap-x-1 gap-y-3 text-lg leading-loose">
          {round?.segments.map((seg, i) =>
            seg.isBlank ? (
              <input
                key={i}
                value={inputs[seg.blankIndex!] ?? ''}
                onChange={(e) => setInput(seg.blankIndex!, e.target.value)}
                disabled={verdicts !== null}
                size={Math.max(4, seg.text.length + 2)}
                className={`mx-0.5 rounded-lg border-2 px-2 py-0.5 text-center font-semibold outline-none ${
                  verdicts === null
                    ? 'border-slate-300 focus:border-teal-500'
                    : verdicts[seg.blankIndex!] === 'wrong'
                      ? 'border-red-400 bg-red-50 text-red-600'
                      : verdicts[seg.blankIndex!] === 'close'
                        ? 'border-amber-400 bg-amber-50 text-amber-700'
                        : 'border-green-400 bg-green-50 text-green-700'
                }`}
              />
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
        </div>

        {verdicts !== null && round && (
          <div className="mt-4 space-y-1.5 rounded-2xl bg-slate-50 p-4">
            {round.answers.map((ans, i) =>
              verdicts[i] !== 'correct' ? (
                <p key={i} className="text-sm text-slate-600">
                  第 {i + 1} 格正解：<span className="font-semibold">{ans}</span>
                  <span className="ml-2 text-xs text-slate-400">
                    （你填的：{inputs[i] || '（空白）'} ・ {VERDICT_LABELS[verdicts[i]]}）
                  </span>
                </p>
              ) : (
                <p key={i} className="text-sm text-green-600">
                  第 {i + 1} 格：{ans} ・ {VERDICT_LABELS[verdicts[i]]}
                </p>
              ),
            )}
            <p className="pt-1 text-sm text-slate-500">完整原文：{round.sourceText}</p>
          </div>
        )}

        <div className="mt-5">
          {verdicts === null ? (
            <button
              onClick={submit}
              disabled={inputs.filter(Boolean).length === 0}
              className="w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-40"
            >
              對答案
            </button>
          ) : (
            <button
              onClick={next}
              className="w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white"
            >
              {roundIndex + 1 < rounds.length ? '下一題 →' : '看總成績'}
            </button>
          )}
        </div>
      </section>
    </main>
  )
}
