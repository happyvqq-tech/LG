// 通關密碼守門：包在整個 App 外層，開通了 ACCESS_PASSPHRASE 的部署
// 才會真的擋人；沒開通的部署（多數家庭第一次部署時）完全感覺不到這層存在。
//
// 這不是帳號系統——全家共用同一組密碼，目的只是擋住網址外流後被陌生人
// 拿去打會花錢的 API（Anthropic、雅婷 TTS）。真正的關卡在 Worker 那端，
// 這裡只是負責問一次、記住答案，讓使用者不用每次開站都重新輸入。
import { useEffect, useState } from 'react'
import {
  loadAccessPassphrase,
  saveAccessPassphrase,
} from '../lib/accessGate'
import { probeAccessGateNeeded, verifyAccessPassphrase } from '../lib/claude'

type GateState = 'checking' | 'locked' | 'unlocked'

export default function AccessGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>('checking')

  useEffect(() => {
    let cancelled = false
    async function boot() {
      const stored = loadAccessPassphrase()
      const result = stored ? await verifyAccessPassphrase(stored) : await probeAccessGateNeeded()
      if (cancelled) return
      if (result === 'unreachable') {
        // 連不上 Worker 的話，卡在這一頁也沒用——就算密碼對了，等一下要
        // 生成任務照樣會連不上，那邊已經有清楚的錯誤訊息，讓使用者先進去
        setState('unlocked')
        return
      }
      setState(result === 'ok' ? 'unlocked' : 'locked')
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [])

  if (state === 'checking') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-slate-400">載入中…</p>
      </main>
    )
  }

  if (state === 'locked') {
    return <PassphrasePrompt onUnlock={() => setState('unlocked')} />
  }

  return <>{children}</>
}

function PassphrasePrompt({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState('')
  const [checking, setChecking] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (checking || value.trim() === '') return
    setChecking(true)
    setErrorMsg('')
    try {
      const result = await verifyAccessPassphrase(value)
      if (result === 'ok') {
        saveAccessPassphrase(value)
        onUnlock()
        return
      }
      setErrorMsg(result === 'wrong' ? '通關密碼不對，請再試一次' : '連不上服務，請檢查網路後重試')
    } finally {
      setChecking(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-sm rounded-3xl bg-white p-8 shadow-sm ring-1 ring-slate-200/60"
      >
        <h1 className="text-2xl font-bold text-teal-800">家庭語言學習</h1>
        <p className="mt-2 text-sm text-slate-500">請輸入通關密碼才能繼續</p>

        <input
          type="password"
          inputMode="text"
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="通關密碼"
          className="mt-5 w-full rounded-xl border border-slate-300 p-3 text-lg"
        />

        {errorMsg && <p className="mt-3 text-sm text-red-600">{errorMsg}</p>}

        <button
          type="submit"
          disabled={checking || value.trim() === ''}
          className="mt-5 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-50"
        >
          {checking ? '確認中…' : '進入'}
        </button>
      </form>
    </main>
  )
}
