// Google 語音停用時的提示條
//
// 為什麼需要：Google 語音失敗三次之後，App 會整個 session 靜默改用瀏覽器內建語音。
// 那個降級設計本身是對的（沒有金鑰、沒有網路、額度用完時 App 都還能用），
// 但「靜默」是錯的——使用者只會覺得聲音突然變機器人、或以為 TTS 壞了，
// 而 Worker 其實已經回傳了很具體的原因，一路被丟掉沒人看。
//
// 靜默降級比壞掉更難查：壞掉至少你知道要去查。
import { useEffect, useState } from 'react'
import { subscribeGoogleTtsDisabled } from '../lib/googleTts'

export default function TtsNotice() {
  const [reason, setReason] = useState('')
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => subscribeGoogleTtsDisabled(setReason), [])

  if (!reason || dismissed) return null

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-2xl bg-amber-50 p-4 shadow-lg ring-1 ring-amber-200">
      <p className="text-sm font-bold text-amber-900">🔈 這次改用手機內建語音</p>
      <p className="mt-1 text-xs leading-relaxed text-amber-800/80">
        雲端語音連續失敗，已暫時停用到重新開啟 App 為止。原因：
        <span className="font-mono">{reason}</span>
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-amber-800/70">
        多半是 Google 那邊的問題：金鑰失效、Text-to-Speech API 沒啟用，或免費額度用完。
        打開 Worker 的 <span className="font-mono">/health</span> 看 google_tts_key 是不是還在。
      </p>
      <button
        onClick={() => setDismissed(true)}
        className="mt-2 w-full rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white"
      >
        知道了
      </button>
    </div>
  )
}
