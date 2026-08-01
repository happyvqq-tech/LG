// 泛聽：大量、輕鬆、聽得下去的長篇材料
//
// 跟每日任務的精聽是兩件事（見 lib/prompts/extensive.ts 的說明）：
// 精聽建立準確度，泛聽建立自動化與語感。只有精聽的學習者會變成
// 「每句都要想」——文法很好、考試很好，但講話卡。
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { createExtensive, deleteExtensive, listExtensive } from '../lib/extensiveService'
import { extensiveLevel } from '../lib/prompts/extensive'
import { ClaudeError } from '../lib/claude'
import { ALL_SCENARIOS, isTaskLanguage, type ExtensiveListen, type Scenario, type TaskLanguage } from '../lib/types'

export default function ExtensiveHome() {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const learnable = useMemo(
    () => (profile?.languages ?? []).filter(isTaskLanguage),
    [profile],
  )
  const [language, setLanguage] = useState<TaskLanguage>(learnable[0] ?? '英文')
  const [items, setItems] = useState<ExtensiveListen[] | null>(null)
  const [generating, setGenerating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [topic, setTopic] = useState<Scenario>('日常')

  useEffect(() => {
    if (!profile) return
    let alive = true
    setItems(null)
    setErrorMsg('')
    listExtensive(profile.id, language)
      .then((list) => {
        if (alive) setItems(list)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setItems([])
        // 表還沒建就是還沒跑 migration-009，這個訊息要說得夠具體才修得動
        const msg = String((e as Error).message)
        setErrorMsg(
          msg.includes('extensive_listens') || msg.includes('does not exist')
            ? '泛聽資料表還沒建立，請到 Supabase SQL Editor 執行 supabase/migration-009.sql'
            : `讀取泛聽教材失敗：${msg}`,
        )
      })
    return () => {
      alive = false
    }
  }, [profile, language])

  async function generate() {
    if (!profile) return
    setGenerating(true)
    setErrorMsg('')
    try {
      const created = await createExtensive(profile.id, language, profile.level, topic)
      setItems((prev) => [created, ...(prev ?? [])])
      navigate(`/extensive/${created.id}`)
    } catch (e: unknown) {
      const msg =
        e instanceof ClaudeError ? e.friendlyMessage : `生成失敗：${String((e as Error).message)}`
      setErrorMsg(msg)
    } finally {
      setGenerating(false)
    }
  }

  async function remove(id: string) {
    if (!profile) return
    try {
      await deleteExtensive(id, profile.id)
      setItems((prev) => (prev ?? []).filter((x) => x.id !== id))
    } catch (e: unknown) {
      setErrorMsg(`刪除失敗：${String((e as Error).message)}`)
    }
  }

  if (!profile) return null

  const easier = extensiveLevel(profile.level)

  return (
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-16">
      <header className="flex items-start justify-between pt-2">
        <div>
          <h1 className="text-2xl font-bold">泛聽</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            長一點、簡單一點，聽個大概就好。不用聽懂每個字，也沒有練習題。
          </p>
        </div>
        <Link
          to="/home"
          className="shrink-0 rounded-full px-4 py-2 text-sm text-slate-500 active:bg-slate-100"
        >
          返回
        </Link>
      </header>

      <div className="mt-4 rounded-2xl bg-sky-50 p-4 ring-1 ring-sky-100">
        <p className="text-sm font-semibold text-sky-800">為什麼要比每日任務簡單？</p>
        <p className="mt-1 text-xs leading-relaxed text-sky-700">
          泛聽要的是「不查字典也聽得下去」，這樣才累積得了量。所以材料會用
          <span className="font-semibold"> {easier} </span>
          生成，比你的學習程度（{profile.level}）低一級。覺得太簡單是正常的——
          輕鬆才聽得多，聽得多才會讓那些字變成反射。
        </p>
      </div>

      {learnable.length > 1 && (
        <div className="mt-5 flex gap-2">
          {learnable.map((l) => (
            <button
              key={l}
              onClick={() => setLanguage(l)}
              className={`rounded-full px-5 py-2 font-semibold ${
                language === l ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 shadow-sm'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <p className="text-sm font-semibold text-slate-600">生成一篇新的（約 600-900 字）</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ALL_SCENARIOS.map((s) => (
            <button
              key={s}
              onClick={() => setTopic(s)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                topic === s ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          onClick={() => void generate()}
          disabled={generating}
          className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 font-bold text-white disabled:opacity-60"
        >
          {generating ? '生成中，約需 15 秒…' : `生成${topic}主題的泛聽材料`}
        </button>
      </section>

      {errorMsg && <p className="mt-4 rounded-xl bg-red-50 p-4 text-red-600">{errorMsg}</p>}

      {items === null && <p className="mt-8 text-center text-slate-400">載入中…</p>}

      {items !== null && items.length === 0 && !errorMsg && (
        <p className="mt-8 text-center text-sm text-slate-400">
          還沒有泛聽材料，先生成一篇試試
        </p>
      )}

      {items !== null && items.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-bold text-slate-500">已有的（{items.length}）</h2>
          <div className="mt-2 grid gap-3">
            {items.map((it) => (
              <div
                key={it.id}
                className="flex items-center gap-3 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60"
              >
                <button
                  onClick={() => navigate(`/extensive/${it.id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <span className="text-slate-400">
                      {new Date(it.created_at).toLocaleDateString('zh-TW')}
                    </span>
                    {it.topic && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
                        {it.topic}
                      </span>
                    )}
                    {it.level && (
                      <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700">
                        {it.level}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block break-words font-bold">{it.title}</span>
                  <span className="mt-0.5 block text-xs text-slate-400">
                    約 {it.script.length} 字
                  </span>
                </button>
                <button
                  onClick={() => void remove(it.id)}
                  aria-label={`刪除 ${it.title}`}
                  className="h-11 w-11 shrink-0 rounded-full text-slate-300 active:bg-slate-100"
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  )
}
