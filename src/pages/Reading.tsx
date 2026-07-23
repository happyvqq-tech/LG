import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { speak, stopSpeaking } from '../lib/speech'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 全文中語塊出現處以底色標記 */
function HighlightedScript({ script, chunkTexts }: { script: string; chunkTexts: string[] }) {
  const parts = useMemo(() => {
    const patterns = chunkTexts
      .filter((t) => t.trim().length > 0)
      .sort((a, b) => b.length - a.length)
      .map(escapeRegExp)
    if (patterns.length === 0) return [script]
    return script.split(new RegExp(`(${patterns.join('|')})`, 'gi'))
  }, [script, chunkTexts])

  const lowerChunks = useMemo(() => new Set(chunkTexts.map((t) => t.toLowerCase())), [chunkTexts])

  return (
    <p className="whitespace-pre-line text-lg leading-relaxed">
      {parts.map((part, i) =>
        lowerChunks.has(part.toLowerCase()) ? (
          <mark key={i} className="rounded bg-amber-200 px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  )
}

export default function Reading() {
  const navigate = useNavigate()
  const { task, loading } = useActiveTask()
  const [speakingChunk, setSpeakingChunk] = useState<number | null>(null)

  if (loading || !task) return <p className="p-10 text-center text-slate-400">載入中…</p>

  const { listening_script, chunks } = task.task_json
  const lang = task.language

  async function speakChunk(i: number, text: string) {
    stopSpeaking()
    setSpeakingChunk(i)
    try {
      await speak(text, lang, 1)
    } catch {
      // 播放失敗不阻擋閱讀
    } finally {
      setSpeakingChunk(null)
    }
  }

  return (
    <main className="mx-auto max-w-xl p-6 pb-10">
      <header className="pt-2">
        <p className="text-sm font-semibold text-teal-700">第二關・閱讀</p>
        <h1 className="mt-1 text-2xl font-bold">{task.task_json.scenario_title}</h1>
      </header>

      <section className="mt-5 rounded-2xl bg-white p-5 shadow">
        <HighlightedScript script={listening_script} chunkTexts={chunks.map((c) => c.text)} />
      </section>

      <h2 className="mt-6 text-lg font-bold text-slate-700">語塊（點卡片聽發音）</h2>
      <div className="mt-3 grid gap-3">
        {chunks.map((c, i) => (
          <button
            key={i}
            onClick={() => void speakChunk(i, c.text)}
            className={`rounded-2xl bg-white p-4 text-left shadow transition active:scale-[0.98] ${
              speakingChunk === i ? 'ring-2 ring-teal-500' : ''
            }`}
          >
            <span className="flex items-center gap-2 text-lg font-bold text-teal-800">
              {c.text}
              <span aria-hidden>🔊</span>
            </span>
            <span className="mt-1 block text-slate-600">{c.zh}</span>
            {c.usage && <span className="mt-1 block text-sm text-slate-400">{c.usage}</span>}
          </button>
        ))}
      </div>

      <button
        onClick={() => {
          stopSpeaking()
          navigate('/speaking')
        }}
        className="mt-8 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-95"
      >
        進入口說
      </button>
    </main>
  )
}
