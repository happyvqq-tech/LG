// 台語首頁：腳本清單 ＋ 生成新腳本 ＋ 進入「聽」或「說」
//
// 台語只做聽與說（CLAUDE.md 第 1 節），所以這裡沒有讀與寫的入口。
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { ClaudeError } from '../lib/claude'
import {
  generateTaigiScript,
  listTaigiScripts,
  deleteTaigiScript,
  loadTaigiProgress,
  type TaigiScriptRow,
} from '../lib/taigiService'
import {
  TAIGI_LEVELS,
  TAIGI_LEVEL_DESC,
  TAIGI_TOPICS,
  type TaigiLevel,
} from '../lib/prompts/taigiScript'
import { TAIGI_VOICES, loadTaigiVoice, saveTaigiVoice, type TaigiVoiceId } from '../lib/taigiVoice'
import { playTaigi, stopTaigi } from '../lib/taigiTts'

const SAMPLE_TEXT = '汝好，今仔日天氣真好。'

export default function TaigiHome() {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const [scripts, setScripts] = useState<TaigiScriptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [generating, setGenerating] = useState(false)
  const [topic, setTopic] = useState<string>(TAIGI_TOPICS[0])
  const [level, setLevel] = useState<TaigiLevel>('日常')
  const [voice, setVoice] = useState<TaigiVoiceId>(() => loadTaigiVoice())
  const [trying, setTrying] = useState(false)
  const [voiceError, setVoiceError] = useState('')

  async function refresh() {
    setLoading(true)
    setErrorMsg('')
    try {
      setScripts(await listTaigiScripts())
    } catch (e: unknown) {
      setErrorMsg(`讀取腳本失敗：${String((e as Error).message)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    return () => stopTaigi()
  }, [])

  async function handleGenerate() {
    if (generating) return
    setGenerating(true)
    setErrorMsg('')
    try {
      const created = await generateTaigiScript(topic, level)
      setScripts((prev) => [created, ...prev])
      navigate(`/taigi/${created.id}/listening`)
    } catch (e: unknown) {
      setErrorMsg(
        e instanceof ClaudeError ? e.friendlyMessage : `腳本生成失敗：${String((e as Error).message)}`,
      )
    } finally {
      setGenerating(false)
    }
  }

  function pickVoice(id: TaigiVoiceId) {
    setVoice(id)
    saveTaigiVoice(id)
  }

  async function trySample() {
    if (trying) return
    setTrying(true)
    setVoiceError('')
    try {
      await playTaigi(SAMPLE_TEXT, voice, 1)
    } catch (e: unknown) {
      const err = e as { friendlyMessage?: string; message: string }
      setVoiceError(err.friendlyMessage ?? err.message)
    } finally {
      setTrying(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('確定要刪除這份腳本嗎？')) return
    try {
      await deleteTaigiScript(id)
      setScripts((prev) => prev.filter((s) => s.id !== id))
    } catch (e: unknown) {
      setErrorMsg(`刪除失敗：${String((e as Error).message)}`)
    }
  }

  return (
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-24">
      <header className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-2xl font-bold text-teal-800">台語</h1>
          <p className="mt-0.5 text-sm text-slate-500">聽 ＋ 說（跟讀），語音來自雅婷 TTS</p>
        </div>
        <Link to="/home" className="rounded-full px-4 py-2 text-sm text-slate-500 active:bg-slate-100">
          返回
        </Link>
      </header>

      {/* 音色 */}
      <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <p className="text-sm font-semibold text-slate-700">台語聲音</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TAIGI_VOICES.map((v) => (
            <button
              key={v.id}
              onClick={() => pickVoice(v.id)}
              className={`rounded-full px-4 py-2.5 text-sm font-semibold transition ${
                voice === v.id ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {v.label}
              <span className="ml-1 text-xs opacity-70">{v.gender}</span>
            </button>
          ))}
          <button
            onClick={() => void trySample()}
            disabled={trying}
            className="rounded-full bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-700 disabled:opacity-50"
          >
            {trying ? '播放中…' : '▶ 試聽'}
          </button>
        </div>
        {voiceError && <p className="mt-2 text-sm text-red-600">{voiceError}</p>}
      </section>

      {/* 生成新腳本 */}
      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <p className="text-sm font-semibold text-slate-700">生成新腳本</p>

        <p className="mt-3 text-xs font-semibold text-slate-500">情境</p>
        <div className="mt-1.5 flex flex-wrap gap-2">
          {TAIGI_TOPICS.map((t) => (
            <button
              key={t}
              onClick={() => setTopic(t)}
              className={`rounded-full px-3.5 py-2 text-sm font-semibold transition ${
                topic === t ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs font-semibold text-slate-500">難度</p>
        <div className="mt-1.5 flex gap-2">
          {TAIGI_LEVELS.map((lv) => (
            <button
              key={lv}
              onClick={() => setLevel(lv)}
              className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
                level === lv ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {lv}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-slate-400">{TAIGI_LEVEL_DESC[level]}</p>

        <button
          onClick={() => void handleGenerate()}
          disabled={generating}
          className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
        >
          {generating ? '生成中，約需 15 秒…' : '生成腳本'}
        </button>
      </section>

      {errorMsg && <div className="mt-4 rounded-xl bg-red-50 p-4 text-red-600">{errorMsg}</div>}

      {/* 腳本清單 */}
      <section className="mt-6">
        <h2 className="text-lg font-bold text-slate-700">腳本庫</h2>
        {loading && <p className="mt-6 text-center text-slate-400">載入中…</p>}
        {!loading && scripts.length === 0 && (
          <p className="mt-4 rounded-2xl bg-white p-6 text-center text-slate-400 shadow-sm">
            還沒有腳本，先生成一份吧
          </p>
        )}
        <div className="mt-3 grid gap-3">
          {scripts.map((s) => {
            const passed = profile ? loadTaigiProgress(profile.id, s.id).size : 0
            return (
              <div key={s.id} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words font-bold">{s.title}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {s.topic ?? '—'}・{s.level ?? '—'}・{s.lines.length} 句
                      {passed > 0 && <span className="text-teal-600">・跟讀過關 {passed} 句</span>}
                    </p>
                  </div>
                  <button
                    onClick={() => void handleDelete(s.id)}
                    aria-label={`刪除 ${s.title}`}
                    className="shrink-0 rounded-full px-3 py-1 text-sm text-slate-300 active:bg-slate-100"
                  >
                    刪除
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => navigate(`/taigi/${s.id}/listening`)}
                    className="rounded-xl bg-teal-50 px-4 py-3 font-semibold text-teal-800 active:scale-95"
                  >
                    🎧 聽
                  </button>
                  <button
                    onClick={() => navigate(`/taigi/${s.id}/shadowing`)}
                    className="rounded-xl bg-teal-50 px-4 py-3 font-semibold text-teal-800 active:scale-95"
                  >
                    🗣️ 說
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </main>
  )
}
