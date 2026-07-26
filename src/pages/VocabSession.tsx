import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { addNewCards, gradeCard, getDueCards } from '../lib/vocabService'
import { logActivity } from '../lib/streakService'
import { MODE_LABELS, modeForStage, type DrillMode, type Grade } from '../lib/srs'
import { speak, stopSpeaking } from '../lib/speech'
import { ClaudeError } from '../lib/claude'
import { judgeAnswer, VERDICT_LABELS } from '../lib/quizGrading'
import { seedsFor, examLanguage, type ExamSystem } from '../data/vocabLists'
import SpeedPicker from '../components/SpeedPicker'
import VoicePicker from '../components/VoicePicker'
import { useSpeechRate } from '../lib/useSpeechRate'
import { DEFAULT_VOCAB_PREF, type Language, type VocabCard } from '../lib/types'

/** 一次 session 最多練幾張，避免一口氣太多 */
const SESSION_CAP = 20

function shuffle<T>(list: T[]): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/** 從其他卡與內建字表湊出干擾選項 */
function buildOptions(card: VocabCard, pool: VocabCard[], field: 'word' | 'meaning_zh'): string[] {
  const correct = card[field]
  const seen = new Set([correct])
  const distractors: string[] = []

  const fromPool = shuffle(pool.filter((c) => c.id !== card.id))
  for (const c of fromPool) {
    const v = c[field]
    if (v && !seen.has(v)) {
      seen.add(v)
      distractors.push(v)
    }
    if (distractors.length === 3) break
  }

  if (distractors.length < 3) {
    const seeds = shuffle(seedsFor(card.exam as ExamSystem, card.exam_level))
    for (const s of seeds) {
      const v = field === 'word' ? s.w : s.zh
      if (v && !seen.has(v)) {
        seen.add(v)
        distractors.push(v)
      }
      if (distractors.length === 3) break
    }
  }

  return shuffle([correct, ...distractors])
}

/** 例句中把該單字挖空 */
function blankOut(example: string, word: string): string {
  if (!example || !word) return example
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return example.replace(new RegExp(escaped, 'gi'), '＿＿＿')
}

export default function VocabSession() {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const pref = profile?.vocab_pref ?? DEFAULT_VOCAB_PREF
  const language: Language = examLanguage(pref.exam as ExamSystem)

  const [queue, setQueue] = useState<VocabCard[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loadNote, setLoadNote] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [showVoicePicker, setShowVoicePicker] = useState(false)
  const [done, setDone] = useState(false)
  const [tally, setTally] = useState({ right: 0, wrong: 0 })
  const startedRef = useRef(false)
  const loggedActivityRef = useRef(false)
  const busyRef = useRef(false)
  const lastGradeRef = useRef<Grade | null>(null)
  const { level: speedLevel, rate, setLevel: setSpeedLevel } = useSpeechRate()

  const card = queue[index] as VocabCard | undefined
  const mode: DrillMode = card ? modeForStage(card.stage) : 'intro'

  const options = useMemo(() => {
    if (!card) return []
    if (mode === 'recognize') return buildOptions(card, queue, 'meaning_zh')
    if (mode === 'recall' || mode === 'listen') return buildOptions(card, queue, 'word')
    return []
  }, [card, queue, mode])

  const start = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setErrorMsg('')
    setLoadNote('')
    try {
      const due = await getDueCards(profile.id, language, SESSION_CAP)
      let all = due

      // 到期的不夠時補新字（新字上限為每日設定值）
      const room = Math.min(pref.daily_new, SESSION_CAP - due.length)
      if (room > 0) {
        setLoadNote('正在準備新單字，約需 10 秒…')
        const fresh = await addNewCards(profile.id, language, pref.exam, pref.exam_level, room)
        all = [...due, ...fresh]
      }

      if (all.length === 0) {
        setDone(true)
      } else {
        setQueue(shuffle(all))
      }
    } catch (e: unknown) {
      const msg = e instanceof ClaudeError ? e.friendlyMessage : `載入單字失敗：${String((e as Error).message)}`
      setErrorMsg(msg)
    } finally {
      setLoading(false)
      setLoadNote('')
    }
  }, [profile, language, pref.daily_new, pref.exam, pref.exam_level])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void start()
  }, [start])

  useEffect(() => () => stopSpeaking(), [])

  // 聽辨關卡刻意不自動播放：iOS Safari 沒有使用者手勢的 speechSynthesis.speak()
  // 會被靜默吃掉（不報錯、也不出聲），使用者會以為壞了。改為下方大喇叭按鈕手動播放。

  if (!profile) return null

  // 產出關卡的判分改用跟每日測驗同一套 judgeAnswer——之前是嚴格字串比對，
  // 打錯一個字母或打成時態變化都直接判死，跟測驗頁的寬容度不一致（見稽核報告 P1-4）
  const produceVerdict = card && mode === 'produce' ? judgeAnswer(typed, card.word, card.reading) : null
  const isCorrect =
    !card || mode === 'intro'
      ? true
      : mode === 'produce'
        ? produceVerdict !== 'wrong'
        : picked === (mode === 'recognize' ? card.meaning_zh : card.word)

  function reveal(answer?: string) {
    if (revealed) return
    if (answer !== undefined) setPicked(answer)
    setRevealed(true)
  }

  async function submitGrade(grade: Grade) {
    // busyRef 是同步鎖，理由同 Writing.tsx 的 submit()（見稽核報告 P0-3）：
    // 連點兩下曾實測讓同一張卡的 SRS 進度被寫兩次，結算畫面分數也算錯
    if (!card || busyRef.current) return
    busyRef.current = true
    lastGradeRef.current = grade
    setSaving(true)
    setSaveError('')
    try {
      if (!loggedActivityRef.current && profile) {
        loggedActivityRef.current = true
        void logActivity(profile.id).catch(() => undefined)
      }
      await gradeCard(card, grade)
      setTally((t) =>
        grade === 'again' ? { ...t, wrong: t.wrong + 1 } : { ...t, right: t.right + 1 },
      )
      stopSpeaking()
      if (index + 1 >= queue.length) {
        setDone(true)
      } else {
        setIndex(index + 1)
        setRevealed(false)
        setPicked(null)
        setTyped('')
      }
    } catch (e: unknown) {
      // 存檔失敗只在原地顯示、可針對這張卡重試，不要把整個 session 的
      // queue/index 沖掉、逼使用者從頭再練一次（見稽核報告 P2-9）
      setSaveError('進度暫時存不起來，請檢查網路後重試')
    } finally {
      busyRef.current = false
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
        <p className="mt-20 text-center text-slate-400">{loadNote || '載入中…'}</p>
      </main>
    )
  }

  if (errorMsg) {
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
        <div className="mt-10 rounded-2xl bg-red-50 p-4 text-red-600">
          {errorMsg}
          <button
            onClick={() => {
              startedRef.current = false
              void start()
            }}
            className="mt-3 block w-full rounded-xl bg-red-600 px-4 py-2 font-semibold text-white"
          >
            重試
          </button>
          <button
            onClick={() => navigate('/vocab')}
            className="mt-2 block w-full rounded-xl bg-white px-4 py-2 font-semibold text-slate-600"
          >
            回單字庫
          </button>
        </div>
      </main>
    )
  }

  if (done || !card) {
    const total = tally.right + tally.wrong
    return (
      <main className="mx-auto max-w-xl lg:max-w-3xl p-6">
        <div className="mt-16 rounded-3xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200/60">
          <p className="text-5xl">{total === 0 ? '☕' : tally.wrong === 0 ? '🏆' : '💪'}</p>
          <h1 className="mt-3 text-2xl font-bold">
            {total === 0 ? '今天沒有要練的字' : '這輪練完了'}
          </h1>
          {total > 0 && (
            <p className="mt-2 text-slate-500">
              答對 {tally.right}／{total}
              {tally.wrong > 0 && '，答錯的字明天會再出現'}
            </p>
          )}
          {total === 0 && (
            <p className="mt-2 text-sm text-slate-500">複習都完成了，可以到設定調高每日新字量</p>
          )}
          <button
            onClick={() => navigate('/vocab')}
            className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white"
          >
            回單字庫
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl lg:max-w-3xl flex-col p-6 pb-10">
      <header className="flex items-center gap-3">
        <button
          onClick={() => {
            stopSpeaking()
            navigate('/vocab')
          }}
          className="-ml-2 rounded-full px-2 text-sm font-semibold text-slate-500 active:bg-slate-100"
        >
          ← 離開
        </button>
        <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
          <span
            className="block h-full rounded-full bg-teal-500 transition-all"
            style={{ width: `${(index / queue.length) * 100}%` }}
          />
        </span>
        <span className="text-sm font-semibold text-slate-500">
          {index + 1}/{queue.length}
        </span>
      </header>

      <div className="mt-3 flex items-center justify-center gap-2">
        <span className="shrink-0 text-xs text-slate-400">語速</span>
        <SpeedPicker level={speedLevel} onChange={setSpeedLevel} showHint={false} compact />
        <button
          onClick={() => {
            stopSpeaking()
            setShowVoicePicker(true)
          }}
          aria-label="換發音"
          className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600"
        >
          🗣️
        </button>
      </div>

      <p className="mt-3 text-center text-sm font-semibold text-teal-700">
        {MODE_LABELS[mode]}
        <span className="ml-2 text-slate-400">關卡 {card.stage + 1}/5</span>
      </p>

      <section className="mt-3 flex-1">
        {/* ---------- 初見：直接給完整資訊 ---------- */}
        {mode === 'intro' && (
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
            <div className="flex items-center justify-center gap-3">
              <h2 className="text-3xl font-bold">{card.word}</h2>
              <button
                onClick={() => void speak(card.word, language, rate).catch(() => undefined)}
                aria-label="聽發音"
                className="rounded-full bg-teal-50 px-3 text-xl"
              >
                🔊
              </button>
            </div>
            {card.reading && <p className="mt-1 text-center text-slate-400">{card.reading}</p>}
            <p className="mt-3 text-center text-xl font-semibold text-teal-800">
              {card.pos && <span className="mr-2 text-sm text-slate-400">{card.pos}</span>}
              {card.meaning_zh}
            </p>

            {card.example && (
              <div className="mt-5 rounded-2xl bg-slate-50 p-4">
                <p className="leading-relaxed">{card.example}</p>
                {card.example_zh && <p className="mt-1 text-sm text-slate-500">{card.example_zh}</p>}
                <button
                  onClick={() => void speak(card.example, language, rate).catch(() => undefined)}
                  className="mt-2 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-teal-700"
                >
                  🔊 聽例句
                </button>
              </div>
            )}

            {card.collocations.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-semibold text-slate-600">常見搭配</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {card.collocations.map((c) => (
                    <span
                      key={c}
                      className="rounded-full bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-700"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------- 認詞 / 回想 / 聽辨：四選一 ---------- */}
        {(mode === 'recognize' || mode === 'recall' || mode === 'listen') && (
          <div>
            <div className="rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/60">
              {mode === 'recognize' && <h2 className="text-3xl font-bold">{card.word}</h2>}
              {mode === 'recall' && (
                <h2 className="text-2xl font-bold text-teal-800">{card.meaning_zh}</h2>
              )}
              {mode === 'listen' && (
                <button
                  onClick={() => void speak(card.word, language, rate).catch(() => undefined)}
                  className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-teal-50 text-4xl active:scale-95"
                  aria-label="再聽一次"
                >
                  🔊
                </button>
              )}
              <p className="mt-2 text-sm text-slate-400">
                {mode === 'recognize' && '這個字是什麼意思？'}
                {mode === 'recall' && '這個意思的字怎麼寫？'}
                {mode === 'listen' && '點上面的喇叭聽發音，再選出是哪一個字'}
              </p>
            </div>

            <div className="mt-4 grid gap-2">
              {options.map((opt) => {
                const correctValue = mode === 'recognize' ? card.meaning_zh : card.word
                const isAnswer = opt === correctValue
                const isPicked = opt === picked
                let cls = 'bg-white text-slate-700 ring-1 ring-slate-200 active:bg-slate-50'
                if (revealed) {
                  if (isAnswer) cls = 'bg-green-100 text-green-700 ring-2 ring-green-500'
                  else if (isPicked) cls = 'bg-red-100 text-red-600 ring-1 ring-red-300'
                  else cls = 'bg-slate-50 text-slate-400 ring-1 ring-slate-100'
                }
                return (
                  <button
                    key={opt}
                    onClick={() => reveal(opt)}
                    className={`rounded-2xl p-4 text-left text-lg font-medium transition ${cls}`}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ---------- 產出：例句挖空拼寫 ---------- */}
        {mode === 'produce' && (
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200/60">
            <p className="text-center text-xl font-bold text-teal-800">{card.meaning_zh}</p>
            {card.example && (
              <p className="mt-4 rounded-2xl bg-slate-50 p-4 text-lg leading-relaxed">
                {blankOut(card.example, card.word)}
              </p>
            )}
            <p className="mt-3 text-sm text-slate-400">把這個字拼出來填進空格</p>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typed.trim() && !revealed) reveal()
              }}
              disabled={revealed}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={`${card.word.slice(0, 1)}…`}
              className="mt-2 w-full rounded-xl border border-slate-300 p-3 text-center text-xl font-semibold"
            />
            {!revealed && (
              <button
                onClick={() => reveal()}
                disabled={!typed.trim()}
                className="mt-3 w-full rounded-xl bg-teal-600 py-3 font-bold text-white disabled:opacity-40"
              >
                對答案
              </button>
            )}
          </div>
        )}

        {/* ---------- 揭曉與評分 ---------- */}
        {revealed && mode !== 'intro' && (
          <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
            <p className={`text-lg font-bold ${isCorrect ? 'text-green-600' : 'text-red-600'}`}>
              {mode === 'produce' && produceVerdict
                ? produceVerdict === 'wrong'
                  ? `正確答案：${card.word}`
                  : `${VERDICT_LABELS[produceVerdict]}：${card.word}`
                : isCorrect
                  ? '答對了！'
                  : `正確答案：${card.word}`}
            </p>
            {!isCorrect && (
              <p className="mt-1 text-slate-600">
                {card.reading && <span className="mr-2 text-slate-400">{card.reading}</span>}
                {card.meaning_zh}
              </p>
            )}
            {card.example && (
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                {card.example}
                {card.example_zh && <span className="block">{card.example_zh}</span>}
              </p>
            )}
          </div>
        )}

        {saveError && (
          <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">
            {saveError}
            <button
              onClick={() => lastGradeRef.current && void submitGrade(lastGradeRef.current)}
              className="ml-3 rounded bg-red-600 px-3 py-1 font-semibold text-white"
            >
              重試
            </button>
          </div>
        )}
      </section>

      {/* ---------- 底部操作 ---------- */}
      <footer className="mt-5">
        {mode === 'intro' && (
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => void submitGrade('hard')}
              disabled={saving}
              className="rounded-xl bg-amber-50 py-3.5 font-bold text-amber-700 ring-1 ring-amber-200 disabled:opacity-50"
            >
              有點難
            </button>
            <button
              onClick={() => void submitGrade('good')}
              disabled={saving}
              className="rounded-xl bg-teal-600 py-3.5 font-bold text-white disabled:opacity-50"
            >
              記住了
            </button>
          </div>
        )}

        {revealed && mode !== 'intro' && !isCorrect && (
          <button
            onClick={() => void submitGrade('again')}
            disabled={saving}
            className="w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-50"
          >
            知道了，下一個
          </button>
        )}

        {revealed && mode !== 'intro' && isCorrect && (
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => void submitGrade('hard')}
              disabled={saving}
              className="rounded-xl bg-amber-50 py-3.5 font-bold text-amber-700 ring-1 ring-amber-200 disabled:opacity-50"
            >
              有點難
            </button>
            <button
              onClick={() => void submitGrade('good')}
              disabled={saving}
              className="rounded-xl bg-teal-600 py-3.5 font-bold text-white disabled:opacity-50"
            >
              剛剛好
            </button>
            <button
              onClick={() => void submitGrade('easy')}
              disabled={saving}
              className="rounded-xl bg-green-50 py-3.5 font-bold text-green-700 ring-1 ring-green-200 disabled:opacity-50"
            >
              太簡單
            </button>
          </div>
        )}

        {revealed && mode !== 'intro' && (
          <p className="mt-2 text-center text-xs text-slate-400">
            選「太簡單」下次會隔比較久才出現
          </p>
        )}
      </footer>

      {showVoicePicker && (
        <VoicePicker language={language} onClose={() => setShowVoicePicker(false)} />
      )}
    </main>
  )
}
