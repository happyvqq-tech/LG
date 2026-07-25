import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { ClaudeError } from '../lib/claude'
import { generateWeeklyReport, getLanguagesWithErrors } from '../lib/weeklyReportService'
import MarkdownView from '../components/MarkdownView'

export default function WeeklyReport() {
  const navigate = useNavigate()
  const { profile } = useProfile()

  const [languages, setLanguages] = useState<string[]>([])
  const [language, setLanguage] = useState('')
  const [loadingLangs, setLoadingLangs] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [noData, setNoData] = useState(false)

  const loadLanguages = useCallback(async () => {
    if (!profile) return
    setLoadingLangs(true)
    try {
      const langs = await getLanguagesWithErrors(profile.id)
      setLanguages(langs)
      setLanguage((prev) => prev || langs[0] || '')
    } catch (e: unknown) {
      setErrorMsg(`讀取失敗：${String((e as Error).message)}`)
    } finally {
      setLoadingLangs(false)
    }
  }, [profile])

  useEffect(() => {
    void loadLanguages()
  }, [loadLanguages])

  async function generate() {
    if (!profile || !language || generating) return
    setGenerating(true)
    setErrorMsg('')
    setMarkdown(null)
    setNoData(false)
    try {
      const result = await generateWeeklyReport(profile.id, profile.name, language)
      if (result.errorCount === 0) setNoData(true)
      else setMarkdown(result.markdown)
    } catch (e: unknown) {
      const msg = e instanceof ClaudeError ? e.friendlyMessage : `生成失敗：${String((e as Error).message)}`
      setErrorMsg(msg)
    } finally {
      setGenerating(false)
    }
  }

  if (!profile) return null

  return (
    <main className="mx-auto max-w-xl lg:max-w-3xl p-6 pb-16">
      <button
        onClick={() => navigate('/home')}
        className="-ml-2 flex items-center gap-1 rounded-full px-2 text-sm font-semibold text-slate-500 active:bg-slate-100"
      >
        ← 回首頁
      </button>

      <header className="mt-1">
        <h1 className="text-2xl font-bold">週報</h1>
        <p className="mt-1 text-sm text-slate-500">讀近 30 天的錯誤紀錄，歸納避坑指南</p>
      </header>

      {loadingLangs && <p className="mt-10 text-center text-slate-400">載入中…</p>}

      {!loadingLangs && languages.length === 0 && !errorMsg && (
        <p className="mt-10 rounded-2xl bg-white p-6 text-center text-slate-400 shadow-sm ring-1 ring-slate-200/60">
          還沒有任何錯誤紀錄，完成任務或古文翻譯後就能生成週報
        </p>
      )}

      {!loadingLangs && languages.length > 0 && (
        <>
          {languages.length > 1 && (
            <div className="mt-5 flex flex-wrap gap-2">
              {languages.map((l) => (
                <button
                  key={l}
                  onClick={() => {
                    setLanguage(l)
                    setMarkdown(null)
                    setNoData(false)
                  }}
                  className={`rounded-full px-4 py-2 font-semibold ${
                    language === l ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => void generate()}
            disabled={generating}
            className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
          >
            {generating ? '生成中，約需 10-20 秒…' : markdown || noData ? '重新生成' : `生成 ${language} 週報`}
          </button>

          {noData && (
            <p className="mt-4 rounded-2xl bg-green-50 p-4 text-center text-green-700 ring-1 ring-green-100">
              最近 30 天沒有{language}的錯誤紀錄，太厲害了 🎉
            </p>
          )}

          {markdown && (
            <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
              <MarkdownView markdown={markdown} />
            </section>
          )}
        </>
      )}

      {errorMsg && (
        <div className="mt-4 rounded-xl bg-red-50 p-4 text-red-600">
          {errorMsg}
          <button
            onClick={() => void generate()}
            className="mt-3 block w-full rounded-lg bg-red-600 px-4 py-2 font-semibold text-white"
          >
            重試
          </button>
        </div>
      )}
    </main>
  )
}
