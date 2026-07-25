import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProfile } from '../lib/profileContext'
import { speak } from '../lib/speech'
import { MAX_STAGE, MODE_LABELS, modeForStage } from '../lib/srs'
import { examLanguage, type ExamSystem } from '../data/vocabLists'
import SpeedPicker from '../components/SpeedPicker'
import { useSpeechRate } from '../lib/useSpeechRate'
import { DEFAULT_VOCAB_PREF, type Language, type VocabCard } from '../lib/types'

type Filter = 'all' | 'learning' | 'mastered'

const SOURCE_LABELS: Record<string, string> = {
  list: '字表',
  ai: 'AI',
  task: '任務生字',
}

export default function VocabList() {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const pref = profile?.vocab_pref ?? DEFAULT_VOCAB_PREF
  const language: Language = examLanguage(pref.exam as ExamSystem)

  const [cards, setCards] = useState<VocabCard[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const { level: speedLevel, rate, setLevel: setSpeedLevel } = useSpeechRate()

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    setErrorMsg('')
    const { data, error } = await supabase
      .from('vocab_cards')
      .select('*')
      .eq('profile_id', profile.id)
      .eq('language', language)
      .order('created_at', { ascending: false })
    if (error) setErrorMsg(`讀取失敗：${error.message}`)
    else setCards((data ?? []) as VocabCard[])
    setLoading(false)
  }, [profile, language])

  useEffect(() => {
    void load()
  }, [load])

  if (!profile) return null

  const q = query.trim().toLowerCase()
  const shown = cards
    .filter((c) =>
      filter === 'learning' ? c.stage > 0 && c.stage < MAX_STAGE : filter === 'mastered' ? c.stage >= MAX_STAGE : true,
    )
    .filter((c) => q === '' || c.word.toLowerCase().includes(q) || c.meaning_zh.toLowerCase().includes(q))

  return (
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-24">
      <button
        onClick={() => navigate('/vocab')}
        className="-ml-2 flex items-center gap-1 rounded-full px-2 text-sm font-semibold text-slate-500 active:bg-slate-100"
      >
        ← 回單字庫
      </button>

      <h1 className="mt-1 text-2xl font-bold">我的單字</h1>

      <div className="mt-4 flex gap-2">
        {([
          ['all', `全部 ${cards.length}`],
          ['learning', `學習中 ${cards.filter((c) => c.stage > 0 && c.stage < MAX_STAGE).length}`],
          ['mastered', `已學會 ${cards.filter((c) => c.stage >= MAX_STAGE).length}`],
        ] as Array<[Filter, string]>).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              filter === key ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜尋單字或中文意思…"
        className="mt-3 w-full rounded-xl border border-slate-300 p-3"
      />

      <div className="mt-3 flex items-center gap-2">
        <span className="shrink-0 text-sm text-slate-500">語速</span>
        <SpeedPicker level={speedLevel} onChange={setSpeedLevel} showHint={false} compact />
      </div>

      {loading && <p className="mt-10 text-center text-slate-400">載入中…</p>}
      {errorMsg && <p className="mt-6 rounded-xl bg-red-50 p-4 text-red-600">{errorMsg}</p>}

      {!loading && shown.length === 0 && (
        <p className="mt-10 text-center text-slate-400">
          {cards.length === 0 ? '這裡還沒有單字，先去練一輪吧' : '找不到符合的單字'}
        </p>
      )}

      <div className="mt-4 grid gap-2">
        {shown.map((c) => {
          const open = expanded === c.id
          const mastered = c.stage >= MAX_STAGE
          return (
            <div key={c.id} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
              <button
                onClick={() => setExpanded(open ? null : c.id)}
                className="flex w-full items-center gap-3 text-left"
              >
                <span className="flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-lg font-bold">{c.word}</span>
                    {c.reading && <span className="text-sm text-slate-400">{c.reading}</span>}
                  </span>
                  <span className="mt-0.5 block text-sm text-slate-600">{c.meaning_zh}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                    mastered ? 'bg-green-50 text-green-700' : 'bg-teal-50 text-teal-700'
                  }`}
                >
                  {mastered ? '已學會' : MODE_LABELS[modeForStage(c.stage)]}
                </span>
              </button>

              {open && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <button
                    onClick={() => void speak(c.word, language, rate).catch(() => undefined)}
                    className="rounded-full bg-teal-50 px-4 py-2 text-sm font-semibold text-teal-700"
                  >
                    🔊 聽發音
                  </button>

                  {c.example && (
                    <div className="mt-3 rounded-xl bg-slate-50 p-3">
                      <p className="leading-relaxed">{c.example}</p>
                      {c.example_zh && <p className="mt-1 text-sm text-slate-500">{c.example_zh}</p>}
                    </div>
                  )}

                  {c.collocations.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {c.collocations.map((col) => (
                        <span
                          key={col}
                          className="rounded-full bg-amber-50 px-3 py-1 text-sm font-semibold text-amber-700"
                        >
                          {col}
                        </span>
                      ))}
                    </div>
                  )}

                  <p className="mt-3 text-xs text-slate-400">
                    {SOURCE_LABELS[c.source] ?? c.source}
                    {c.exam && `・${c.exam} ${c.exam_level}`}
                    ・下次複習 {c.due_date}
                    {c.lapses > 0 && `・忘記過 ${c.lapses} 次`}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </main>
  )
}
