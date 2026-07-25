import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { ErrorRecord, ErrorStatus } from '../lib/types'

const STATUS_BADGE: Record<ErrorStatus, { label: string; cls: string }> = {
  active: { label: '學習中', cls: 'bg-red-50 text-red-600' },
  pending_verify: { label: '驗證中', cls: 'bg-amber-50 text-amber-600' },
  resolved: { label: '已攻克', cls: 'bg-green-100 text-green-700' },
}

/** 錯誤庫全螢幕面板：依 error_type 分組，已攻克區給成就感樣式 */
export default function ErrorBank({
  profileId,
  language,
  onClose,
}: {
  profileId: string
  language: string
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [records, setRecords] = useState<ErrorRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    supabase
      .from('errors')
      .select('*')
      .eq('profile_id', profileId)
      .eq('language', language)
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setErrorMsg(`讀取錯誤庫失敗：${error.message}`)
        else setRecords((data ?? []) as ErrorRecord[])
        setLoading(false)
      })
  }, [profileId, language])

  const { openGroups, resolved } = useMemo(() => {
    const open = records.filter((r) => r.status !== 'resolved')
    const groups = new Map<string, ErrorRecord[]>()
    for (const r of open) {
      const list = groups.get(r.error_type) ?? []
      list.push(r)
      groups.set(r.error_type, list)
    }
    return {
      openGroups: [...groups.entries()].sort((a, b) => b[1].length - a[1].length),
      resolved: records.filter((r) => r.status === 'resolved'),
    }
  }, [records])

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50">
      <div className="mx-auto max-w-xl p-6 pb-16">
        <header className="flex items-center justify-between pt-2">
          <h1 className="text-2xl font-bold">錯誤庫（{language}）</h1>
          <button onClick={onClose} className="rounded-full bg-white px-4 py-2 font-semibold text-slate-600 shadow-sm">
            關閉
          </button>
        </header>

        {loading && <p className="mt-10 text-center text-slate-400">載入中…</p>}
        {errorMsg && <p className="mt-6 rounded-xl bg-red-50 p-4 text-red-600">{errorMsg}</p>}
        {!loading && records.length === 0 && !errorMsg && (
          <p className="mt-10 text-center text-slate-400">還沒有錯誤紀錄，完成任務後會自動累積</p>
        )}

        {!loading && (openGroups.length > 0 || resolved.length > 0) && (
          <div className="mt-4 flex gap-2">
            {openGroups.length > 0 && (
              <button
                onClick={() => navigate(`/error-review/${encodeURIComponent(language)}`)}
                className="flex-1 rounded-xl bg-teal-600 py-3 font-bold text-white active:scale-95"
              >
                ⚡ 快速複習
              </button>
            )}
            <button
              onClick={() => navigate('/weekly-report')}
              className="rounded-xl bg-white px-4 py-3 font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200"
            >
              📊 週報
            </button>
          </div>
        )}

        {openGroups.map(([type, list]) => (
          <section key={type} className="mt-6">
            <h2 className="font-bold text-slate-700">
              {type} <span className="text-sm font-normal text-slate-400">({list.length})</span>
            </h2>
            <div className="mt-2 grid gap-2">
              {list.map((r) => {
                const badge = STATUS_BADGE[r.status]
                return (
                  <div key={r.id} className="rounded-2xl bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm">
                        <span className="text-red-500 line-through">{r.original}</span>
                        {' → '}
                        <span className="font-semibold text-green-600">{r.corrected}</span>
                      </p>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${badge.cls}`}>
                        {badge.label}
                        {r.status === 'active' && r.verify_count > 0 ? ` ${r.verify_count}/2` : ''}
                      </span>
                    </div>
                    {r.rule_note && <p className="mt-1.5 text-xs text-slate-400">{r.rule_note}</p>}
                  </div>
                )
              })}
            </div>
          </section>
        ))}

        {resolved.length > 0 && (
          <section className="mt-8">
            <h2 className="font-bold text-green-700">🏆 已攻克（{resolved.length}）</h2>
            <div className="mt-2 grid gap-2">
              {resolved.map((r) => (
                <div
                  key={r.id}
                  className="rounded-2xl border-2 border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm text-slate-600">
                      <span className="line-through opacity-60">{r.original}</span>
                      {' → '}
                      <span className="font-semibold text-green-700">{r.corrected}</span>
                    </p>
                    <span className="shrink-0 text-lg">✨</span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-green-600">{r.error_type}・驗證通過</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
