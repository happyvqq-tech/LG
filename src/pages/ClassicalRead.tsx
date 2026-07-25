import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { callClaudeJSON, ClaudeError } from '../lib/claude'
import { speak, stopSpeaking, ttsSupported } from '../lib/speech'
import { getIndexEntry, getNotes, getProgress, getText, saveProgress } from '../lib/classicalService'
import {
  annotateSystemPrompt,
  isAnnotateResult,
  isTranslationGradeResult,
  translationGraderSystemPrompt,
  type AnnotateResult,
  type TranslationGradeResult,
} from '../lib/prompts/classicalTutor'
import SpeedPicker from '../components/SpeedPicker'
import { useSpeechRate } from '../lib/useSpeechRate'
import {
  buildPunctuationTask,
  punctuationComment,
  scorePunctuation,
  splitByBreaks,
  takeSegment,
  type PunctuationScore,
} from '../lib/punctuation'

type Step = 'read' | 'punctuate' | 'notes' | 'translate' | 'comprehend'

const STEPS: Array<{ key: Step; label: string; icon: string }> = [
  { key: 'read', label: '誦讀', icon: '🔊' },
  { key: 'punctuate', label: '句讀', icon: '✂️' },
  { key: 'notes', label: '字詞', icon: '📖' },
  { key: 'translate', label: '翻譯', icon: '✍️' },
  { key: 'comprehend', label: '文意', icon: '💭' },
]

export default function ClassicalRead() {
  const navigate = useNavigate()
  const { textId = '' } = useParams()
  const { profile } = useProfile()
  const entry = getIndexEntry(textId)

  const [paras, setParas] = useState<string[]>([])
  const [paraIndex, setParaIndex] = useState(0)
  const [step, setStep] = useState<Step>('read')
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  // 句讀
  const [userBreaks, setUserBreaks] = useState<Set<number>>(new Set())
  const [punctScore, setPunctScore] = useState<PunctuationScore | null>(null)

  // 字詞與翻譯
  const [annotation, setAnnotation] = useState<AnnotateResult | null>(null)
  const [annotating, setAnnotating] = useState(false)
  const [userTranslation, setUserTranslation] = useState('')
  const [grade, setGrade] = useState<TranslationGradeResult | null>(null)
  const [grading, setGrading] = useState(false)

  // 吳楚材原評
  const [showNotes, setShowNotes] = useState(false)
  const [oldNotes, setOldNotes] = useState<string[]>([])

  const [speaking, setSpeaking] = useState(false)
  const loadedRef = useRef('')
  const { level: speedLevel, rate, setLevel: setSpeedLevel } = useSpeechRate()

  const passage = paras[paraIndex] ?? ''
  // 長段落只取一段來練句讀，避免一次要斷幾十處
  const segment = useMemo(() => takeSegment(passage, 80), [passage])
  const task = useMemo(() => buildPunctuationTask(segment), [segment])

  const load = useCallback(async () => {
    if (!profile || !textId) return
    setLoading(true)
    setErrorMsg('')
    try {
      const [text, prog] = await Promise.all([getText(textId), getProgress(profile.id, textId)])
      if (text.length === 0) throw new Error('找不到這篇的原文')
      setParas(text)
      setParaIndex(Math.min(prog?.para_index ?? 0, text.length - 1))
    } catch (e: unknown) {
      setErrorMsg(`載入失敗：${String((e as Error).message)}`)
    } finally {
      setLoading(false)
    }
  }, [profile, textId])

  useEffect(() => {
    if (loadedRef.current === textId) return
    loadedRef.current = textId
    void load()
  }, [load, textId])

  useEffect(() => () => stopSpeaking(), [])

  // 換段時把該段的作答狀態清乾淨
  useEffect(() => {
    setStep('read')
    setUserBreaks(new Set())
    setPunctScore(null)
    setAnnotation(null)
    setUserTranslation('')
    setGrade(null)
  }, [paraIndex])

  if (!profile) return null
  if (!entry) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p className="mt-20 text-center text-slate-400">找不到這一篇</p>
        <button
          onClick={() => navigate('/classical')}
          className="mt-4 w-full rounded-xl bg-teal-600 py-3 font-bold text-white"
        >
          回篇目列表
        </button>
      </main>
    )
  }

  async function play(text: string) {
    stopSpeaking()
    setSpeaking(true)
    try {
      await speak(text, '古文', rate)
    } catch {
      // 播放失敗不影響閱讀
    } finally {
      setSpeaking(false)
    }
  }

  function toggleBreak(i: number) {
    if (punctScore) return // 已對答案就不能再改
    const next = new Set(userBreaks)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setUserBreaks(next)
  }

  async function submitPunctuation() {
    const s = scorePunctuation([...userBreaks], task.breaks)
    setPunctScore(s)
    try {
      await saveProgress(profile!.id, textId, { punctuation_best: s.f1, para_index: paraIndex })
    } catch {
      // 進度存不起來不該擋住學習
    }
  }

  async function runAnnotate() {
    if (annotating || annotation) return
    setAnnotating(true)
    setErrorMsg('')
    try {
      const result = await callClaudeJSON<AnnotateResult>(
        {
          module: 'grader',
          system: annotateSystemPrompt({
            title: entry!.title,
            source: entry!.source,
            passage,
            level: entry!.level,
          }),
          messages: [{ role: 'user', content: '請講解本段' }],
          maxTokens: 3000,
        },
        isAnnotateResult,
      )
      setAnnotation(result)
    } catch (e: unknown) {
      const msg = e instanceof ClaudeError ? e.message : `講解失敗：${String((e as Error).message)}`
      setErrorMsg(msg)
    } finally {
      setAnnotating(false)
    }
  }

  async function submitTranslation() {
    if (grading || !userTranslation.trim()) return
    setGrading(true)
    setErrorMsg('')
    try {
      const result = await callClaudeJSON<TranslationGradeResult>(
        {
          module: 'grader',
          system: translationGraderSystemPrompt({
            title: entry!.title,
            passage,
            userTranslation: userTranslation.trim(),
            level: entry!.level,
          }),
          messages: [{ role: 'user', content: '請批改' }],
          maxTokens: 3000,
        },
        isTranslationGradeResult,
      )
      setGrade(result)
      await saveProgress(profile!.id, textId, {
        translation_best: Math.round(result.score),
        para_index: paraIndex,
      }).catch(() => undefined)
    } catch (e: unknown) {
      const msg = e instanceof ClaudeError ? e.message : `批改失敗：${String((e as Error).message)}`
      setErrorMsg(msg)
    } finally {
      setGrading(false)
    }
  }

  async function openOldNotes() {
    setShowNotes(true)
    if (oldNotes.length === 0) setOldNotes(await getNotes(textId))
  }

  async function nextPara() {
    stopSpeaking()
    const isLast = paraIndex + 1 >= paras.length
    await saveProgress(profile!.id, textId, {
      para_index: isLast ? paraIndex : paraIndex + 1,
      status: isLast ? 'done' : 'reading',
    }).catch(() => undefined)
    if (isLast) navigate('/classical')
    else setParaIndex(paraIndex + 1)
  }

  if (loading) {
    return <p className="p-10 text-center text-slate-400">載入原文中…</p>
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step)

  return (
    <main className="mx-auto max-w-xl p-6 pb-12">
      <button
        onClick={() => {
          stopSpeaking()
          navigate('/classical')
        }}
        className="-ml-2 flex items-center gap-1 rounded-full px-2 text-sm font-semibold text-slate-500 active:bg-slate-100"
      >
        ← 篇目
      </button>

      <header className="mt-1">
        <h1 className="text-2xl font-bold">{entry.title}</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          {entry.source}・{entry.era}・第 {paraIndex + 1}/{paras.length} 段
        </p>
      </header>

      {/* 步驟列 */}
      <ol className="mt-4 flex items-start">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex flex-1 items-start last:flex-none">
            <button
              onClick={() => setStep(s.key)}
              className="flex flex-col items-center gap-1 px-1"
              aria-current={i === stepIndex ? 'step' : undefined}
            >
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-full text-sm transition ${
                  i === stepIndex
                    ? 'bg-teal-600 text-white shadow-md shadow-teal-600/30'
                    : i < stepIndex
                      ? 'bg-teal-100 text-teal-700'
                      : 'bg-slate-100 text-slate-400'
                }`}
              >
                {i < stepIndex ? '✓' : s.icon}
              </span>
              <span
                className={`text-xs font-semibold ${
                  i === stepIndex ? 'text-teal-700' : i < stepIndex ? 'text-teal-600' : 'text-slate-400'
                }`}
              >
                {s.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <span
                className={`mt-[18px] h-0.5 flex-1 rounded-full ${
                  i < stepIndex ? 'bg-teal-300' : 'bg-slate-200'
                }`}
              />
            )}
          </li>
        ))}
      </ol>

      {errorMsg && <p className="mt-4 rounded-xl bg-red-50 p-3 text-red-600">{errorMsg}</p>}

      {/* ---------- 誦讀 ---------- */}
      {step === 'read' && (
        <section className="mt-5">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
            <p className="text-xl leading-loose tracking-wide">{passage}</p>
          </div>
          {!ttsSupported() && (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">
              此瀏覽器不支援朗讀，可以自己讀出聲，效果一樣好
            </p>
          )}
          <div className="mt-3">
            <p className="text-sm font-semibold text-slate-600">語速</p>
            <div className="mt-1.5">
              <SpeedPicker
                level={speedLevel}
                onChange={(lv) => {
                  stopSpeaking()
                  setSpeaking(false)
                  setSpeedLevel(lv)
                }}
              />
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => void play(passage)}
              className="flex-1 rounded-xl bg-teal-50 py-3 font-semibold text-teal-700 ring-1 ring-teal-200"
            >
              {speaking ? '朗讀中…' : '🔊 朗讀'}
            </button>
            <button
              onClick={() => {
                stopSpeaking()
                setSpeaking(false)
              }}
              className="rounded-xl bg-slate-100 px-5 font-semibold text-slate-600"
            >
              停
            </button>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-500">
            先聽兩遍、跟著唸一遍。文言的停頓與節奏是語感的來源，聽熟了再去斷句會輕鬆很多。
          </p>
          <button
            onClick={() => setStep('punctuate')}
            className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-95"
          >
            我讀熟了 → 練句讀
          </button>
        </section>
      )}

      {/* ---------- 句讀 ---------- */}
      {step === 'punctuate' && (
        <section className="mt-5">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
            <p className="text-sm text-slate-500">
              點字表示「在這個字後面斷開」，再點一次取消。
              {task.plain.length < passage.replace(/[，、。；：？！「」『』]/g, '').length &&
                '（長段落只取前面一小段來練）'}
            </p>
            <p className="mt-3 text-xl leading-loose tracking-wide">
              {[...task.plain].map((ch, i) => {
                const marked = userBreaks.has(i)
                const isCorrect = punctScore?.hitPositions.includes(i)
                const isExtra = punctScore?.extraPositions.includes(i)
                const isMissed = punctScore?.missedPositions.includes(i)
                return (
                  <span key={i} className="inline-block">
                    <button
                      onClick={() => toggleBreak(i)}
                      className={`min-h-0 min-w-0 rounded px-0.5 py-0.5 transition ${
                        isCorrect
                          ? 'bg-green-100 text-green-700'
                          : isExtra
                            ? 'bg-red-100 text-red-600'
                            : isMissed
                              ? 'bg-amber-100 text-amber-700'
                              : marked
                                ? 'bg-teal-100 text-teal-800'
                                : ''
                      }`}
                    >
                      {ch}
                    </button>
                    {(marked || isMissed) && (
                      <span
                        className={`px-0.5 font-bold ${isMissed ? 'text-amber-500' : 'text-teal-500'}`}
                      >
                        ／
                      </span>
                    )}
                  </span>
                )
              })}
            </p>
          </div>

          {!punctScore ? (
            <button
              onClick={() => void submitPunctuation()}
              disabled={userBreaks.size === 0}
              className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-40"
            >
              對答案（已標 {userBreaks.size} 處）
            </button>
          ) : (
            <>
              <div className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
                <p className="text-2xl font-bold text-teal-700">{Math.round(punctScore.f1 * 100)}%</p>
                <p className="mt-1 text-slate-600">{punctuationComment(punctScore)}</p>
                <p className="mt-2 text-sm text-slate-500">
                  斷對 {punctScore.hit}・
                  <span className="text-amber-600">漏斷 {punctScore.missed}</span>・
                  <span className="text-red-500">多斷 {punctScore.extra}</span>
                </p>
                <div className="mt-3 rounded-xl bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-600">正確斷句</p>
                  <p className="mt-1 leading-relaxed">
                    {splitByBreaks(task.plain, task.breaks).join('／')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setStep('notes')}
                className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-95"
              >
                看字詞講解 →
              </button>
            </>
          )}
        </section>
      )}

      {/* ---------- 字詞 ---------- */}
      {step === 'notes' && (
        <section className="mt-5">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
            <p className="text-lg leading-loose">{passage}</p>
          </div>

          {!annotation ? (
            <button
              onClick={() => void runAnnotate()}
              disabled={annotating}
              className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
            >
              {annotating ? '講解中，約需 10 秒…' : '請老師講解這段'}
            </button>
          ) : (
            <>
              <div className="mt-4 grid gap-2">
                {annotation.notes.map((n, i) => (
                  <div key={i} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
                    <span className="flex items-center gap-2">
                      <span className="text-lg font-bold text-teal-800">{n.word}</span>
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        {n.type}
                      </span>
                    </span>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">{n.explain}</p>
                  </div>
                ))}
              </div>

              <button
                onClick={() => void openOldNotes()}
                className="mt-3 w-full rounded-xl bg-slate-100 py-3 text-sm font-semibold text-slate-600"
              >
                📜 看吳楚材原評（清代選家的批註，文言）
              </button>

              <button
                onClick={() => setStep('translate')}
                className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-95"
              >
                自己翻譯看看 →
              </button>
            </>
          )}
        </section>
      )}

      {/* ---------- 翻譯 ---------- */}
      {step === 'translate' && (
        <section className="mt-5">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
            <p className="text-lg leading-loose">{passage}</p>
            <textarea
              value={userTranslation}
              onChange={(e) => setUserTranslation(e.target.value)}
              rows={5}
              disabled={grading}
              placeholder="用白話把這段翻出來，直譯為主"
              className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-base"
            />
            <button
              onClick={() => void submitTranslation()}
              disabled={grading || !userTranslation.trim()}
              className="mt-2 w-full rounded-xl bg-teal-600 py-3 font-bold text-white disabled:opacity-40"
            >
              {grading ? '批改中…' : grade ? '重新批改' : '提交批改'}
            </button>
          </div>

          {grade && (
            <div className="mt-4">
              <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
                <p className="text-2xl font-bold text-teal-700">{Math.round(grade.score)} 分</p>
                {grade.praise && <p className="mt-1 text-green-700">👍 {grade.praise}</p>}
                <div className="mt-3 rounded-xl bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-600">參考譯文</p>
                  <p className="mt-1 leading-relaxed">{grade.reference}</p>
                </div>
              </div>

              {grade.issues.length === 0 ? (
                <p className="mt-3 rounded-2xl bg-green-50 p-4 text-center text-green-700">
                  沒有需要修正的地方 🎉
                </p>
              ) : (
                <div className="mt-3 grid gap-2">
                  {grade.issues.map((iss, i) => (
                    <div key={i} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600">
                          {iss.error_type}
                        </span>
                        {iss.method && (
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                            六法・{iss.method}
                          </span>
                        )}
                      </span>
                      <p className="mt-2 font-semibold text-slate-700">{iss.original}</p>
                      <p className="mt-1 text-sm">
                        <span className="text-red-500 line-through">{iss.user}</span>
                        {' → '}
                        <span className="font-semibold text-green-600">{iss.correct}</span>
                      </p>
                      {iss.note && <p className="mt-1 text-sm text-slate-500">{iss.note}</p>}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setStep('comprehend')}
                className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-95"
              >
                想想文意 →
              </button>
            </div>
          )}
        </section>
      )}

      {/* ---------- 文意 ---------- */}
      {step === 'comprehend' && (
        <section className="mt-5">
          {!annotation?.questions?.length ? (
            <p className="rounded-2xl bg-white p-5 text-center text-slate-500 shadow-sm ring-1 ring-slate-200/60">
              這段沒有額外的思考題，直接進下一段吧
            </p>
          ) : (
            <div className="grid gap-3">
              {annotation.questions.map((q, i) => (
                <details key={i} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
                  <summary className="cursor-pointer font-semibold text-slate-700">{q.q}</summary>
                  <p className="mt-2 text-sm leading-relaxed text-slate-500">💡 {q.hint}</p>
                </details>
              ))}
            </div>
          )}

          <button
            onClick={() => void nextPara()}
            className="mt-5 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-95"
          >
            {paraIndex + 1 >= paras.length ? '讀完這篇 🎉' : '下一段 →'}
          </button>
        </section>
      )}

      {/* 吳楚材原評 */}
      {showNotes && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40 backdrop-blur-sm"
          onClick={() => setShowNotes(false)}
        >
          <div
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 pb-10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200" />
            <h2 className="mt-4 text-xl font-bold">吳楚材原評</h2>
            <p className="mt-1 text-sm text-slate-500">
              清代《古文觀止》編者的批註，本身也是文言，供進階參考
            </p>
            <div className="mt-4 grid gap-2">
              {oldNotes.length === 0 && <p className="text-slate-400">這篇沒有夾註</p>}
              {oldNotes.map((n, i) => (
                <p key={i} className="rounded-xl bg-slate-50 p-3 text-sm leading-relaxed">
                  {n}
                </p>
              ))}
            </div>
            <button
              onClick={() => setShowNotes(false)}
              className="mt-5 w-full rounded-xl bg-slate-100 py-3 font-semibold text-slate-600"
            >
              關閉
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
