import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useProfile } from '../lib/profileContext'
import { fileToAvatarDataUrl } from '../lib/avatar'
import { downloadIcs } from '../lib/ics'
import Avatar from '../components/Avatar'
import LevelPicker from '../components/LevelPicker'
import DailyPlanEditor from '../components/DailyPlanEditor'
import {
  ALL_SCENARIOS,
  LEVEL_INFO,
  WEEKDAY_LABELS,
  type DailyPlan,
  type Language,
  type Level,
  type Profile,
  type Scenario,
} from '../lib/types'

const ALL_LANGUAGES: Language[] = ['英文', '日文', '韓文', '台語', '古文']

/**
 * 尚未實作的語言：選了也不會有任何學習內容，所以明確標示出來，
 * 不要留一個看起來能選、選了卻什麼都沒有的選項。
 * 台語卡在發音來源——瀏覽器沒有台語語音，需要另外的音檔或付費 TTS
 * （CLAUDE.md 第 10 節：雅婷需使用者明確同意才實作）。
 */
const UNAVAILABLE_LANGUAGES: Language[] = ['台語']

function planSummary(plan: DailyPlan | null): string | null {
  if (!plan || plan.days.length === 0) return null
  const days =
    plan.days.length === 7
      ? '每天'
      : plan.days.length === 5 && plan.days.every((d) => d >= 1 && d <= 5)
        ? '平日'
        : plan.days.map((d) => WEEKDAY_LABELS[d]).join('')
  return `${days} ${plan.time}・${plan.minutes} 分鐘`
}

export default function MemberSelect() {
  const navigate = useNavigate()
  const { selectProfile } = useProfile()
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editing, setEditing] = useState<Profile | null>(null)
  const [creating, setCreating] = useState(false)

  async function fetchProfiles() {
    setLoading(true)
    setLoadError('')
    const { data, error } = await supabase.from('profiles').select('*').order('created_at')
    if (error) {
      setLoadError(`讀取成員失敗：${error.message}`)
    } else {
      // 防禦：回應非陣列時不讓整頁白屏
      setProfiles(Array.isArray(data) ? (data as Profile[]) : [])
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
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-24">
      <header className="pt-8 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-teal-800">家庭語言學習</h1>
        <p className="mt-2 text-slate-500">今天誰要練習？</p>
      </header>

      {loading && <p className="mt-12 text-center text-slate-400">載入中…</p>}

      {loadError && (
        <div className="mt-12 rounded-2xl bg-red-50 p-4 text-center text-red-600">
          {loadError}
          <button
            onClick={() => void fetchProfiles()}
            className="mt-3 block w-full rounded-xl bg-red-600 px-4 py-2 font-semibold text-white"
          >
            重試
          </button>
        </div>
      )}

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {profiles.map((p) => {
          const summary = planSummary(p.daily_plan)
          return (
            <div key={p.id} className="relative">
              <button
                onClick={() => handlePick(p)}
                className="w-full rounded-3xl bg-white p-6 text-left shadow-sm ring-1 ring-slate-200/60 transition hover:shadow-md active:scale-95"
              >
                <Avatar profile={p} size="md" />
                <span className="mt-3 block text-xl font-bold">{p.name}</span>
                <span className="mt-0.5 block text-sm text-slate-500">
                  {p.languages.join('・')}｜{p.level} {LEVEL_INFO[p.level]?.label ?? ''}
                </span>
                {summary && (
                  <span className="mt-2 inline-block rounded-full bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">
                    ⏰ {summary}
                  </span>
                )}
              </button>
              <button
                onClick={() => setEditing(p)}
                aria-label={`編輯 ${p.name}`}
                className="absolute right-2 top-2 rounded-full px-3 text-sm text-slate-400 active:bg-slate-100"
              >
                編輯
              </button>
            </div>
          )
        })}

        {!loading && (
          <button
            onClick={() => setCreating(true)}
            className="flex min-h-[10rem] w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 p-6 text-slate-400 transition hover:border-teal-400 hover:text-teal-600 active:scale-95"
          >
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-3xl">
              ＋
            </span>
            <span className="mt-3 block text-lg font-semibold">新增成員</span>
          </button>
        )}
      </div>

      {editing && (
        <ProfileDrawer
          mode="edit"
          profile={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void fetchProfiles()
          }}
        />
      )}

      {creating && (
        <ProfileDrawer
          mode="create"
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            void fetchProfiles()
          }}
        />
      )}
    </main>
  )
}

function ProfileDrawer({
  mode,
  profile,
  onClose,
  onSaved,
}: {
  mode: 'edit' | 'create'
  profile?: Profile
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(profile?.name ?? '')
  const [languages, setLanguages] = useState<Language[]>(profile?.languages ?? ['英文'])
  const [level, setLevel] = useState<Level>(profile?.level ?? 'B1')
  const [scenarioPool, setScenarioPool] = useState<Scenario[]>(profile?.scenario_pool ?? [...ALL_SCENARIOS])
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url ?? null)
  const [dailyPlan, setDailyPlan] = useState<DailyPlan | null>(profile?.daily_plan ?? null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function toggle<T>(list: T[], item: T): T[] {
    return list.includes(item) ? list.filter((x) => x !== item) : [...list, item]
  }

  async function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // 允許重選同一張
    if (!file) return
    setSaveError('')
    try {
      setAvatarUrl(await fileToAvatarDataUrl(file))
    } catch (err: unknown) {
      setSaveError(`照片處理失敗：${String((err as Error).message)}`)
    }
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
    if (dailyPlan && dailyPlan.days.length === 0) {
      setSaveError('學習提醒請至少選一天，或按「取消提醒」')
      return
    }
    setSaving(true)
    setSaveError('')

    const payload = {
      name: name.trim(),
      languages,
      level,
      scenario_pool: scenarioPool,
      avatar_url: avatarUrl,
      daily_plan: dailyPlan,
    }

    const { error } =
      mode === 'edit' && profile
        ? await supabase.from('profiles').update(payload).eq('id', profile.id)
        : await supabase.from('profiles').insert(payload)

    setSaving(false)
    if (error) {
      setSaveError(`儲存失敗：${error.message}`)
    } else {
      onSaved()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200" />
        <h2 className="mt-4 text-xl font-bold">{mode === 'create' ? '新增成員' : '編輯成員'}</h2>

        {/* 照片 */}
        <div className="mt-4 flex items-center gap-4">
          <Avatar profile={{ name: name || '新', avatar_url: avatarUrl }} size="lg" />
          <div className="flex flex-col gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600"
            >
              {avatarUrl ? '換一張照片' : '上傳照片'}
            </button>
            {avatarUrl && (
              <button
                onClick={() => setAvatarUrl(null)}
                className="rounded-xl px-4 text-sm text-slate-400 active:bg-slate-100"
              >
                移除照片
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => void handlePickFile(e)}
            className="hidden"
          />
        </div>

        <label className="mt-5 block text-sm font-semibold text-slate-600" htmlFor="member-name">
          名稱
        </label>
        <input
          id="member-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：小明"
          className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-lg"
        />

        <p className="mt-5 text-sm font-semibold text-slate-600">語言（可複選）</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ALL_LANGUAGES.map((lang) => {
            const unavailable = UNAVAILABLE_LANGUAGES.includes(lang)
            return (
              <button
                key={lang}
                onClick={() => !unavailable && setLanguages(toggle(languages, lang))}
                disabled={unavailable}
                className={`rounded-full px-5 py-2.5 font-semibold transition ${
                  unavailable
                    ? 'cursor-not-allowed bg-slate-50 text-slate-300'
                    : languages.includes(lang)
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                }`}
              >
                {lang}
                {unavailable && <span className="ml-1 text-xs">（尚未開放）</span>}
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-xs text-slate-400">
          英文／日文／韓文有完整的聽說讀寫任務；古文有專屬的句讀、字詞、翻譯模組
        </p>

        <p className="mt-5 text-sm font-semibold text-slate-600">程度（滑過或點選看說明）</p>
        <div className="mt-2">
          <LevelPicker value={level} onChange={setLevel} />
        </div>

        <p className="mt-5 text-sm font-semibold text-slate-600">情境池（可複選）</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {ALL_SCENARIOS.map((s) => (
            <button
              key={s}
              onClick={() => setScenarioPool(toggle(scenarioPool, s))}
              className={`rounded-full px-5 py-2.5 font-semibold transition ${
                scenarioPool.includes(s) ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <p className="mt-5 text-sm font-semibold text-slate-600">每日學習提醒</p>
        <div className="mt-2">
          <DailyPlanEditor plan={dailyPlan} onChange={setDailyPlan} />
        </div>
        {mode === 'edit' && profile && dailyPlan && dailyPlan.days.length > 0 && (
          <button
            onClick={() => downloadIcs({ ...profile, name: name.trim() || profile.name }, dailyPlan)}
            className="mt-2 w-full rounded-xl bg-sky-50 py-3 font-semibold text-sky-700 ring-1 ring-sky-200"
          >
            📅 下載行事曆提醒檔（.ics）
          </button>
        )}
        {mode === 'create' && (
          <p className="mt-2 text-xs text-slate-400">儲存後回來編輯，即可下載行事曆提醒檔</p>
        )}

        {saveError && <p className="mt-4 rounded-xl bg-red-50 p-3 text-red-600">{saveError}</p>}

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
