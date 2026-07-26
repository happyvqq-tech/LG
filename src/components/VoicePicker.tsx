// 語音選擇器：列出這台裝置可用的語音，可試聽、可指定
//
// 自動挑選只能靠語音名稱與 localService 猜，一定有猜不準的裝置。
// 這個抽屜讓使用者自己聽過再決定，是「聽起來像機器人」最直接的解法。
import { useEffect, useState } from 'react'
import { listVoices, stopSpeaking } from '../lib/speech'
import { clearVoicePref, loadVoicePref, saveVoicePref } from '../lib/voicePref'
import { isHighQuality, isPoorQuality } from '../lib/voiceScore'
import type { Language } from '../lib/types'

/** 各語言的試聽句：長度夠聽出語調起伏，又不會久到不耐煩 */
const SAMPLE_TEXT: Record<Language, string> = {
  英文: "Hi! I'd like a large coffee and a croissant, please. How much is that?",
  日文: 'すみません、コーヒーを一つお願いします。おいくらですか。',
  台語: '你好，我欲買一杯咖啡。',
  古文: '山不在高，有仙則名。水不在深，有龍則靈。',
}

/** 依裝置給「去哪裡裝更自然的語音」的指引——這是品質天花板的真正決定因素 */
function installHint(): { platform: string; steps: string } | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) {
    return {
      platform: 'iPhone / iPad',
      steps:
        '設定 → 輔助使用 → 朗讀內容 → 聲音 → 英文，選一個標示「加強版」或「進階版」的聲音下載。內建的壓縮版聲音就是最像機器人的那個。',
    }
  }
  if (/Android/.test(ua)) {
    return {
      platform: 'Android',
      steps:
        '設定 → 系統 → 語言與輸入法 → 文字轉語音輸出，確認引擎是「Google 語音服務」，進去安裝英文語音資料。連著網路時會用線上語音，比離線的自然很多。',
    }
  }
  if (/Macintosh/.test(ua)) {
    return {
      platform: 'Mac',
      steps:
        '系統設定 → 輔助使用 → 朗讀內容 → 系統聲音 → 管理聲音，下載英文的「進階版」或 Siri 聲音。',
    }
  }
  return {
    platform: '電腦',
    steps:
      '用 Microsoft Edge 開這個網頁，可以直接使用「Natural」系列的線上語音，是目前瀏覽器內建裡最自然的一批。',
  }
}

export default function VoicePicker({
  language,
  onClose,
  onChanged,
}: {
  language: Language
  onClose: () => void
  /** 選好之後通知外層（例如重新播放目前這句） */
  onChanged?: () => void
}) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null)
  const [selected, setSelected] = useState<string | null>(() => loadVoicePref(language))
  const [previewing, setPreviewing] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void listVoices(language).then((list) => {
      if (alive) setVoices(list)
    })
    return () => {
      alive = false
      stopSpeaking()
    }
  }, [language])

  async function preview(v: SpeechSynthesisVoice) {
    stopSpeaking()
    setPreviewing(v.voiceURI)
    // 直接指定要試聽的那個語音，不能走 speak()——那會套用目前的偏好設定，
    // 使用者就聽不到「還沒選的這個」到底是什麼聲音
    try {
      const utter = new SpeechSynthesisUtterance(SAMPLE_TEXT[language])
      utter.voice = v
      utter.lang = v.lang
      await new Promise<void>((resolve) => {
        utter.onend = () => resolve()
        utter.onerror = () => resolve()
        window.speechSynthesis.speak(utter)
      })
    } finally {
      setPreviewing(null)
    }
  }

  function choose(v: SpeechSynthesisVoice) {
    saveVoicePref(language, v.voiceURI)
    setSelected(v.voiceURI)
    onChanged?.()
    void preview(v)
  }

  function useAuto() {
    clearVoicePref(language)
    setSelected(null)
    onChanged?.()
  }

  const hint = installHint()

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200" />
        <h2 className="mt-4 text-xl font-bold">{language}發音設定</h2>
        <p className="mt-1 text-sm text-slate-500">
          點右邊的 🔊 試聽，覺得順耳就按「使用」。不同裝置可用的聲音差很多。
        </p>

        {voices === null && <p className="mt-6 text-center text-slate-400">讀取可用語音…</p>}

        {voices?.length === 0 && (
          <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-700">
            這台裝置沒有找到{language}語音，會使用瀏覽器預設的聲音。可以參考下面的說明安裝。
          </p>
        )}

        {voices && voices.length > 0 && (
          <div className="mt-4 grid gap-2">
            <button
              onClick={useAuto}
              className={`rounded-2xl p-4 text-left ring-1 ${
                selected === null ? 'bg-teal-50 ring-2 ring-teal-500' : 'bg-white ring-slate-200'
              }`}
            >
              <span className="font-bold">自動挑選（推薦）</span>
              <span className="mt-0.5 block text-sm text-slate-500">
                自動選這台裝置上最自然的一個：{voices[0].name}
              </span>
            </button>

            {voices.map((v) => {
              const isSelected = selected === v.voiceURI
              return (
                <div
                  key={v.voiceURI}
                  className={`flex items-center gap-3 rounded-2xl p-4 ring-1 ${
                    isSelected ? 'bg-teal-50 ring-2 ring-teal-500' : 'bg-white ring-slate-200'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 font-semibold">
                      <span className="break-words">{v.name}</span>
                      {isHighQuality(v) && (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                          自然
                        </span>
                      )}
                      {isPoorQuality(v) && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                          機械感重
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {v.lang}
                      {v.localService ? '・離線' : '・線上'}
                    </p>
                  </div>
                  <button
                    onClick={() => void preview(v)}
                    aria-label={`試聽 ${v.name}`}
                    className="h-11 w-11 shrink-0 rounded-full bg-slate-100 text-lg active:bg-slate-200"
                  >
                    {previewing === v.voiceURI ? '⏸' : '🔊'}
                  </button>
                  <button
                    onClick={() => choose(v)}
                    disabled={isSelected}
                    className="shrink-0 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white disabled:bg-teal-100 disabled:text-teal-600"
                  >
                    {isSelected ? '使用中' : '使用'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {hint && (
          <div className="mt-5 rounded-2xl bg-sky-50 p-4 ring-1 ring-sky-100">
            <p className="font-semibold text-sky-800">想要更自然的聲音？（{hint.platform}）</p>
            <p className="mt-1 text-sm leading-relaxed text-sky-700">{hint.steps}</p>
            <p className="mt-2 text-xs text-sky-600">
              裝好之後回到這頁重新整理，新的聲音就會出現在上面的清單裡。
            </p>
          </div>
        )}

        <button
          onClick={() => {
            stopSpeaking()
            onClose()
          }}
          className="mt-5 w-full rounded-xl bg-slate-100 py-3 font-semibold text-slate-600"
        >
          關閉
        </button>
      </div>
    </div>
  )
}
