// 教材複習：翻開一份過去的任務，重聽聽力稿、複習語塊、回看對話與批改
//
// 這頁是唯讀的。舊任務的作答與批改是已經發生的紀錄，開放重做等於把歷史蓋掉，
// 所以這裡只播放與展示，要重練請回首頁生成新任務。
//
// 唯一會寫回資料庫的是「顯示中文」——舊任務當初若沒按過那顆按鈕就沒有翻譯，
// 這裡補生成一次並存回 task_json（純新增欄位，不動任何既有紀錄）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { getTaskById } from '../lib/taskService'
import { speak, speakSequence, splitSentences, stopSpeaking, ttsSupported } from '../lib/speech'
import { ensureListeningTranslation } from '../lib/translationService'
import { useSpeechRate } from '../lib/useSpeechRate'
import SpeedPicker from '../components/SpeedPicker'
import VoicePicker from '../components/VoicePicker'
import type { ChatMessage, Task } from '../lib/types'

function formatDate(iso: string): string {
  const d = new Date(iso)
  const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()]
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}（週${weekday}）`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <h2 className="font-bold text-slate-700">{title}</h2>
      {children}
    </section>
  )
}

function Transcript({ messages, title }: { messages: ChatMessage[]; title: string }) {
  return (
    <Section title={`${title}（${messages.length} 則）`}>
      <div className="mt-3 grid gap-2">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
              m.role === 'user'
                ? 'ml-auto bg-teal-600 text-white'
                : 'mr-auto bg-slate-100 text-slate-700'
            }`}
          >
            {m.content}
          </div>
        ))}
      </div>
    </Section>
  )
}

export default function TaskReview() {
  const { taskId } = useParams<{ taskId: string }>()
  const navigate = useNavigate()
  const { profile } = useProfile()

  const [task, setTask] = useState<Task | null>(null)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  const { level: speedLevel, rate, setLevel: setSpeedLevel } = useSpeechRate()
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [playingAll, setPlayingAll] = useState(false)
  const [showVoicePicker, setShowVoicePicker] = useState(false)
  // 複習跟第一次聽不一樣：原文預設攤開（要對照著看），中文才藏起來
  const [showText, setShowText] = useState(true)
  const [showZh, setShowZh] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState('')
  const sessionRef = useRef(0)

  useEffect(() => {
    if (!profile || !taskId) return
    let alive = true
    setLoading(true)
    getTaskById(taskId, profile.id)
      .then((t) => {
        if (!alive) return
        // 找不到，或這份教材屬於別的成員（共用裝置換人後直接打網址）
        if (!t) navigate('/archive', { replace: true })
        else setTask(t)
      })
      .catch((e: unknown) => {
        if (alive) setErrorMsg(`讀取教材失敗：${String((e as Error).message)}`)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [profile, taskId, navigate])

  // 離開頁面時停止播放
  useEffect(() => {
    return () => {
      sessionRef.current++
      stopSpeaking()
    }
  }, [])

  const sentences = useMemo(
    () => splitSentences(task?.task_json.listening_script ?? ''),
    [task],
  )
  const lang = task?.language ?? '英文'
  const translations = task?.task_json.listening_translation ?? null

  function stop() {
    sessionRef.current++
    stopSpeaking()
    setPlayingIndex(null)
    setPlayingAll(false)
  }

  async function playOne(i: number) {
    stop()
    const session = ++sessionRef.current
    setPlayingIndex(i)
    try {
      await speak(sentences[i], lang, rate)
    } catch (e: unknown) {
      if (sessionRef.current === session) setErrorMsg((e as Error).message)
    } finally {
      if (sessionRef.current === session) setPlayingIndex(null)
    }
  }

  async function playAll() {
    stop()
    const session = ++sessionRef.current
    setPlayingAll(true)
    try {
      await speakSequence(sentences, lang, rate, (i) => {
        if (sessionRef.current === session) setPlayingIndex(i)
      })
    } catch (e: unknown) {
      if (sessionRef.current === session) setErrorMsg((e as Error).message)
    } finally {
      if (sessionRef.current === session) {
        setPlayingAll(false)
        setPlayingIndex(null)
      }
    }
  }

  /** 語塊、範例句單獨播一句 */
  async function playText(text: string) {
    stop()
    const session = ++sessionRef.current
    try {
      await speak(text, lang, rate)
    } catch {
      // 單句試聽失敗不必打斷複習
    } finally {
      if (sessionRef.current === session) setPlayingIndex(null)
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

  if (loading) return <p className="p-10 text-center text-slate-400">載入中…</p>
  if (!task) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p className="rounded-xl bg-red-50 p-4 text-red-600">{errorMsg || '找不到這份教材'}</p>
        <button
          onClick={() => navigate('/archive')}
          className="mt-4 w-full rounded-xl bg-slate-100 py-3 font-semibold text-slate-600"
        >
          回教材庫
        </button>
      </main>
    )
  }

  const t = task.task_json
  const grading = t.grading

  return (
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-16">
      <button
        onClick={() => {
          stop()
          navigate('/archive')
        }}
        className="-ml-2 flex items-center gap-1 rounded-full px-2 text-sm font-semibold text-slate-500 active:bg-slate-100"
      >
        ← 教材庫
      </button>

      <header className="mt-2">
        <p className="text-sm font-semibold text-teal-700">
          {formatDate(task.created_at)}・{task.language}
        </p>
        <h1 className="mt-1 break-words text-2xl font-bold">{t.scenario_title}</h1>
        <p className="mt-1 text-slate-500">{t.scenario_desc}</p>
        {t.grammar_points_used.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.grammar_points_used.map((g) => (
              <span
                key={g}
                className="rounded-full bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-700"
              >
                {g}
              </span>
            ))}
          </div>
        )}
      </header>

      {!ttsSupported() && (
        <p className="mt-5 rounded-xl bg-amber-50 p-4 text-amber-700">
          此瀏覽器不支援語音播放，下面的內容仍可閱讀。
        </p>
      )}

      {/* ---------- 聽力稿 ---------- */}
      {sentences.length > 0 && (
        <Section title={`🎧 聽力稿（${sentences.length} 句）`}>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => (playingAll ? stop() : void playAll())}
              className="rounded-full bg-teal-600 px-4 py-2 text-sm font-bold text-white"
            >
              {playingAll ? '⏸ 停止' : '▶ 整段播放'}
            </button>
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
          </div>

          {translating && <p className="mt-2 text-sm text-slate-400">翻譯中…</p>}
          {translateError && <p className="mt-2 text-sm text-red-600">{translateError}</p>}

          <div className="mt-3 grid gap-1.5">
            {sentences.map((s, i) => (
              <div
                key={i}
                className={`flex items-start gap-3 rounded-xl p-3 ${
                  playingIndex === i ? 'bg-teal-50 ring-1 ring-teal-300' : 'bg-slate-50'
                }`}
              >
                <button
                  onClick={() => void playOne(i)}
                  aria-label={`播放第 ${i + 1} 句`}
                  className="h-10 w-10 shrink-0 rounded-full bg-white text-base shadow-sm active:bg-slate-100"
                >
                  {playingIndex === i ? '⏸' : '🔊'}
                </button>
                <div className="min-w-0 flex-1">
                  {showText ? (
                    <p className="break-words leading-relaxed">{s}</p>
                  ) : (
                    <p className="text-sm text-slate-400">第 {i + 1} 句（原文已隱藏）</p>
                  )}
                  {showZh && translations?.[i] && (
                    <p className="mt-1 text-sm text-teal-700">{translations[i]}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-slate-100 pt-4">
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
        </Section>
      )}

      {/* ---------- 語塊 ---------- */}
      {t.chunks.length > 0 && (
        <Section title={`🧩 語塊（${t.chunks.length}）`}>
          <div className="mt-3 grid gap-2">
            {t.chunks.map((c, i) => (
              <div key={i} className="rounded-xl bg-slate-50 p-3">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => void playText(c.text)}
                    aria-label={`播放 ${c.text}`}
                    className="h-10 w-10 shrink-0 rounded-full bg-white text-base shadow-sm active:bg-slate-100"
                  >
                    🔊
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-semibold">{c.text}</p>
                    <p className="mt-0.5 text-sm text-slate-500">{c.zh}</p>
                    {c.usage && <p className="mt-1 text-xs text-slate-400">{c.usage}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ---------- 口說 ---------- */}
      {(t.speaking_goal || t.speaking_role_setup) && (
        <Section title="🗣️ 口說任務">
          {t.speaking_goal && (
            <p className="mt-2 text-slate-700">
              <span className="font-semibold">目標：</span>
              {t.speaking_goal}
            </p>
          )}
          {t.speaking_role_setup && (
            <p className="mt-1 text-sm text-slate-500">
              <span className="font-semibold">AI 角色：</span>
              {t.speaking_role_setup}
            </p>
          )}
        </Section>
      )}

      {t.speaking_transcript && t.speaking_transcript.length > 0 && (
        <Transcript messages={t.speaking_transcript} title="情境對話逐字稿" />
      )}
      {t.discuss_transcript && t.discuss_transcript.length > 0 && (
        <Transcript messages={t.discuss_transcript} title="重點討論逐字稿" />
      )}

      {/* ---------- 寫作與批改 ---------- */}
      {t.writing_prompt && (
        <Section title="✍️ 寫作">
          <p className="mt-2 text-slate-700">{t.writing_prompt}</p>
          {t.writing_answer ? (
            <div className="mt-3 rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-400">你的作答</p>
              <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">
                {t.writing_answer}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-400">這次沒有提交作答</p>
          )}
        </Section>
      )}

      {grading && (
        <>
          {grading.praise && (
            <p className="mt-4 rounded-2xl bg-green-50 p-4 text-green-700 ring-1 ring-green-100">
              👍 {grading.praise}
            </p>
          )}

          <Section title="📝 批改">
            {grading.minimal_fix && (
              <div className="mt-3 rounded-xl bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-400">最小修改版</p>
                <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">
                  {grading.minimal_fix}
                </p>
              </div>
            )}
            {grading.native_version && (
              <div className="mt-2 rounded-xl bg-sky-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-sky-600">母語自然版</p>
                  <button
                    onClick={() => void playText(grading.native_version)}
                    aria-label="播放母語自然版"
                    className="h-8 w-8 shrink-0 rounded-full bg-white text-sm shadow-sm active:bg-slate-100"
                  >
                    🔊
                  </button>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed text-sky-900">
                  {grading.native_version}
                </p>
              </div>
            )}
          </Section>

          <Section title={`🔍 犯錯清單（${grading.errors.length}）`}>
            {grading.errors.length === 0 && (
              <p className="mt-2 text-green-600">這次沒有新錯誤 🎉</p>
            )}
            <div className="mt-3 grid gap-2">
              {grading.errors.map((e, i) => (
                <div key={i} className="rounded-xl bg-slate-50 p-3">
                  <span className="text-xs font-semibold text-red-500">{e.error_type}</span>
                  <p className="mt-0.5 break-words text-sm">
                    <span className="text-red-500 line-through">{e.original}</span>
                    {' → '}
                    <span className="font-semibold text-green-700">{e.corrected}</span>
                  </p>
                  <p className="mt-1 text-sm text-slate-500">{e.rule_note}</p>
                </div>
              ))}
            </div>
          </Section>
        </>
      )}

      {errorMsg && <p className="mt-4 rounded-xl bg-red-50 p-4 text-red-600">{errorMsg}</p>}

      {showVoicePicker && (
        <VoicePicker language={lang} onClose={() => setShowVoicePicker(false)} />
      )}
    </main>
  )
}
