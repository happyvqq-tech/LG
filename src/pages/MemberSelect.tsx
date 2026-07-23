import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProfile } from '../lib/profileContext'
import { ALL_LEVELS, ALL_SCENARIOS, type Language, type Level, type Profile, type Scenario } from '../lib/types'

const ALL_LANGUAGES: Language[] = ['英文', '日文', '台語']

export default function MemberSelect() {
  const navigate = useNavigate()
  const { selectProfile } = useProfile()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState<Profile | null>(null)

  async function fetchProfiles() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase.from('profiles').select('*').order('created_at')
    if (error) {
      setLoadError(`讀取成員失敗：${error.message}`)
    } else {
      setProfiles((data ?? []) as Profile[])
    }
    setLoading(false)
  }

  useEffect(() => {
    void fetchProfiles()
  }, [])

  function handlePick(p: Profile) {
    selectProfile(p)
    navigate('/home')
  }

  return (
    <main className="mx-auto max-w-xl p-6 pb-24">
      <h1 className="pt-6 text-center text-3xl font-bold text-teal-800">家庭語言學習</h1>
      <p className="mt-2 text-center text-slate-500">今天誰要練習？</p>

      {loading && <p className="mt-12 text-center text-slate-400">載入中…</p>}
      {loadError && (
        <div className="mt-12 rounded-xl bg-red-50 p-4 text-center text-red-600">
          {loadError}
          <button
            onClick={() => void fetchProfiles()}
            className="mt-3 block w-full rounded-lg bg-red-600 px-4 py-2 font-semibold text-white"
          >
            重試
          </button>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {profiles.map((p) => (
          <div key={p.id} className="relative">
            <button
              onClick={() => handlePick(p)}
              className="w-full rounded-2xl bg-white p-6 text-left shadow transition active:scale-95"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-600 text-2xl font-bold text-white">
                {p.name.slice(0, 1)}
              </span>
              <span className="mt-3 block text-xl font-bold">{p.name}</span>
              <span className="mt-1 block text-sm text-slate-500">
                {p.languages.join('・')}｜{p.level}
              </span>
            </button>
            <button
              onClick={() => setEditing(p)}
              aria-label={`編輯 ${p.name}`}
              className="absolute right-3 top-3 rounded-full px-3 py-1 text-sm text-slate-400 active:bg-slate-100"
            >
              編輯
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <EditDrawer
          profile={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void fetchProfiles()
          }}
        />
      )}
    </main>
  )
}

function EditDrawer({
  profile,
  onClose,
  onSaved,
}: {
  profile: Profile
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(profile.name)
  const [languages, setLanguages] = useState<Language[]>(profile.languages)
  const [level, setLevel] = useState<Level>(profile.level)
  const [scenarioPool, setScenarioPool] = useState<Scenario[]>(profile.scenario_pool)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  function toggle<T>(list: T[], item: T): T[] {
    return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
  }

  async function handleSave() {
    if (!name.trim()) {
      setSaveError('名稱不可空白')
      return
    }
    if (languages.length === 0) {
      setSaveError('至少選一種語言')
      return
    }
    setSaving(true)
    setSaveError('')
    const { error } = await supabase
      .from('profiles')
      .update({ name: name.trim(), languages, level, scenario_pool: scenarioPool })
      .eq('id', profile.id)
    setSaving(false)
    if (error) {
      setSaveError(`儲存失敗：${error.message}`)
    } else {
      onSaved()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200" />
        <h2 className="mt-4 text-xl font-bold">編輯成員</h2>

        <label className="mt-4 block text-sm font-semibold text-slate-600">名稱</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-lg"
        />

        <p className="mt-4 text-sm font-semibold text-slate-600">語言（可複選）</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ALL_LANGUAGES.map((lang) => (
            <button
              key={lang}
              onClick={() => setLanguages(toggle(languages, lang))}
              className={`rounded-full px-5 py-2.5 font-semibold ${
                languages.includes(lang) ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {lang}
            </button>
          ))}
        </div>

        <p className="mt-4 text-sm font-semibold text-slate-600">程度</p>
        <div className="mt-2 flex gap-2">
          {ALL_LEVELS.map((lv) => (
            <button
              key={lv}
              onClick={() => setLevel(lv)}
              className={`rounded-full px-5 py-2.5 font-semibold ${
                level === lv ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {lv}
            </button>
          ))}
        </div>

        <p className="mt-4 text-sm font-semibold text-slate-600">情境池（可複選）</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ALL_SCENARIOS.map((s) => (
            <button
              key={s}
              onClick={() => setScenarioPool(toggle(scenarioPool, s))}
              className={`rounded-full px-5 py-2.5 font-semibold ${
                scenarioPool.includes(s) ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {saveError && <p className="mt-4 text-red-600">{saveError}</p>}

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-slate-100 py-3 font-semibold text-slate-600"
          >
            取消
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-1 rounded-xl bg-teal-600 py-3 font-semibold text-white disabled:opacity-50"
          >
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  )
}
