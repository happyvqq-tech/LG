// 語音選擇器：列出可用的語音，可依口音篩選、標示男聲女聲、可試聽
//
// 兩個來源並列（見 lib/speech.ts 的說明）：
//   1. 雲端語音（Google）——英日韓才有，音質高且每台裝置聽到的都一樣
//   2. 這台裝置的語音——古文用的是這個，雲端語音不能用時也退回這裡
//
// 自動挑選只能靠語音名稱與 localService 猜，一定有猜不準的裝置。
// 這個抽屜讓使用者自己聽過再決定，是「聽起來像機器人」最直接的解法。
import { useEffect, useMemo, useState } from 'react'
import { listVoices, stopSpeaking } from '../lib/speech'
import {
  clearVoicePref,
  loadVoiceChoice,
  saveGoogleVoicePref,
  saveVoicePref,
} from '../lib/voicePref'
import { isHighQuality, isPoorQuality } from '../lib/voiceScore'
import { googleTtsAvailable, listGoogleVoices, playGoogle } from '../lib/googleTts'
import {
  genderOfGoogleVoice,
  isTopTier,
  langCodeOf,
  shortNameOf,
  tierOf,
  TIER_LABELS,
  type GoogleTier,
  type GoogleVoice,
} from '../lib/googleVoices'
import { accentOf, genderOf, GENDER_LABELS, type VoiceGender } from '../lib/voiceMeta'
import { isTaskLanguage, type Language } from '../lib/types'

/** 各語言的試聽句：長度夠聽出語調起伏，又不會久到不耐煩 */
const SAMPLE_TEXT: Record<Language, string> = {
  英文: "Hi! I'd like a large coffee and a croissant, please. How much is that?",
  日文: 'すみません、コーヒーを一つお願いします。おいくらですか。',
  韓文: '안녕하세요. 커피 한 잔 주세요. 얼마예요?',
  台語: '你好，我欲買一杯咖啡。',
  古文: '山不在高，有仙則名。水不在深，有龍則靈。',
}

/**
 * 把兩種來源收斂成同一個形狀，篩選與排版才不必寫兩套。
 * id 同時當 React key 與「目前選中的是哪一個」的比較依據。
 */
interface PickerVoice {
  id: string
  source: 'google' | 'device'
  /** 顯示用名稱 */
  label: string
  langCode: string
  gender: VoiceGender | null
  tier: GoogleTier | null
  /** 裝置語音才有，試聽時要指定這個物件 */
  deviceVoice: SpeechSynthesisVoice | null
  /** Google 語音才有，就是音色全名 */
  googleName: string | null
}

function toPickerVoice(v: GoogleVoice): PickerVoice {
  return {
    id: `google:${v.name}`,
    source: 'google',
    label: shortNameOf(v.name),
    langCode: langCodeOf(v),
    gender: genderOfGoogleVoice(v),
    tier: tierOf(v.name),
    deviceVoice: null,
    googleName: v.name,
  }
}

function fromDeviceVoice(v: SpeechSynthesisVoice): PickerVoice {
  return {
    id: `device:${v.voiceURI}`,
    source: 'device',
    label: v.name,
    langCode: v.lang,
    gender: genderOf(v.name),
    tier: null,
    deviceVoice: v,
    googleName: null,
  }
}

/** 依裝置給「去哪裡裝更自然的語音」的指引——這只影響裝置語音那一區 */
function installHint(): { platform: string; steps: string } | null {
  if (typeof navigator === 'undefined') return null
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) {
    return {
      platform: 'iPhone / iPad',
      steps:
        '設定 → 輔助使用 → 朗讀內容 → 聲音 → 英文，可以看到美式、英式、澳洲、印度等各種口音的男女聲，選標示「加強版」或「進階版」的下載。內建的壓縮版就是最像機器人的那個。',
    }
  }
  if (/Android/.test(ua)) {
    return {
      platform: 'Android',
      steps:
        '設定 → 系統 → 語言與輸入法 → 文字轉語音輸出，確認引擎是「Google 語音服務」，進去安裝英文語音資料（可分別安裝美式/英式等）。連著網路時會用線上語音，比離線的自然很多。',
    }
  }
  if (/Macintosh/.test(ua)) {
    return {
      platform: 'Mac',
      steps:
        '系統設定 → 輔助使用 → 朗讀內容 → 系統聲音 → 管理聲音，可下載各口音的英文「進階版」或 Siri 聲音。',
    }
  }
  return {
    platform: '電腦',
    steps:
      '用 Microsoft Edge 開這個網頁，可以直接使用「Natural」系列的線上語音，男女聲與美式英式澳洲等口音都有，是目前瀏覽器內建裡最自然的一批。',
  }
}

const ALL = '__all__'

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
  const [deviceVoices, setDeviceVoices] = useState<SpeechSynthesisVoice[] | null>(null)
  const [cloudVoices, setCloudVoices] = useState<GoogleVoice[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const choice = loadVoiceChoice(language)
    if (!choice) return null
    return choice.kind === 'google' ? `google:${choice.name}` : `device:${choice.voiceURI}`
  })
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [accentFilter, setAccentFilter] = useState<string>(ALL)
  const [genderFilter, setGenderFilter] = useState<VoiceGender | typeof ALL>(ALL)

  const cloudPossible = googleTtsAvailable() && isTaskLanguage(language)

  useEffect(() => {
    let alive = true
    void listVoices(language).then((list) => {
      if (alive) setDeviceVoices(list)
    })
    if (isTaskLanguage(language) && googleTtsAvailable()) {
      void listGoogleVoices(language).then((list) => {
        if (alive) setCloudVoices(list)
      })
    } else {
      setCloudVoices([])
    }
    return () => {
      alive = false
      stopSpeaking()
    }
  }, [language])

  const cloudItems = useMemo(() => (cloudVoices ?? []).map(toPickerVoice), [cloudVoices])
  const deviceItems = useMemo(() => (deviceVoices ?? []).map(fromDeviceVoice), [deviceVoices])
  const allItems = useMemo(() => [...cloudItems, ...deviceItems], [cloudItems, deviceItems])

  /** 兩邊加起來實際有哪些口音，只列出來真的存在的 */
  const accents = useMemo(() => {
    const seen = new Map<string, string>()
    for (const v of allItems) {
      const a = accentOf(v.langCode)
      if (!seen.has(a.code)) seen.set(a.code, a.label)
    }
    return [...seen.entries()].map(([code, label]) => ({ code, label }))
  }, [allItems])

  const genders = useMemo(() => {
    const seen = new Set<VoiceGender>()
    for (const v of allItems) if (v.gender) seen.add(v.gender)
    return [...seen]
  }, [allItems])

  function matchesFilter(v: PickerVoice): boolean {
    if (accentFilter !== ALL && accentOf(v.langCode).code !== accentFilter) return false
    if (genderFilter !== ALL && v.gender !== genderFilter) return false
    return true
  }

  const shownCloud = useMemo(
    () => cloudItems.filter(matchesFilter),
    [cloudItems, accentFilter, genderFilter],
  )
  const shownDevice = useMemo(
    () => deviceItems.filter(matchesFilter),
    [deviceItems, accentFilter, genderFilter],
  )

  /**
   * 主畫面只放「最自然」那批（Chirp 3 HD／Chirp HD），其餘收進摺疊區。
   *
   * 為什麼要分：Google 一個語言就給幾十個音色，全部攤平會變成一長串，
   * 而其中真正值得挑的只有頂級那幾個——其他等級留著是備案，不是選項。
   *
   * 兩個退路，確保主畫面永遠不會是空的：
   *   1. 這個語言沒有頂級音色 → 主畫面放全部雲端語音
   *   2. 連雲端語音都沒有（沒設金鑰等）→ 裝置語音就是唯一選擇，直接攤開
   */
  const hasTopTier = shownCloud.some((v) => isTopTier(v.tier))
  const featuredCloud = hasTopTier ? shownCloud.filter((v) => isTopTier(v.tier)) : shownCloud
  const restCloud = hasTopTier ? shownCloud.filter((v) => !isTopTier(v.tier)) : []
  const cloudEmpty = shownCloud.length === 0
  const featuredDevice = cloudEmpty ? shownDevice : []
  const hiddenDevice = cloudEmpty ? [] : shownDevice
  const hiddenCount = restCloud.length + hiddenDevice.length

  const [showMore, setShowMore] = useState(false)
  /** 使用中的音色被收在摺疊區裡的話自動展開，否則會找不到「使用中」在哪 */
  const selectedIsHidden =
    selectedId !== null &&
    [...restCloud, ...hiddenDevice].some((v) => v.id === selectedId)
  useEffect(() => {
    if (selectedIsHidden) setShowMore(true)
  }, [selectedIsHidden])

  async function preview(v: PickerVoice) {
    stopSpeaking()
    setPreviewing(v.id)
    // 直接指定要試聽的那一個，不能走 speak()——那會套用目前的偏好設定，
    // 使用者就聽不到「還沒選的這個」到底是什麼聲音
    try {
      if (v.source === 'google' && v.googleName) {
        await playGoogle(SAMPLE_TEXT[language], v.googleName, 1)
      } else if (v.deviceVoice) {
        const utter = new SpeechSynthesisUtterance(SAMPLE_TEXT[language])
        utter.voice = v.deviceVoice
        utter.lang = v.deviceVoice.lang
        await new Promise<void>((resolve) => {
          utter.onend = () => resolve()
          utter.onerror = () => resolve()
          window.speechSynthesis.speak(utter)
        })
      }
    } catch {
      // 試聽失敗（雲端語音連不上等）就當作沒聽到，不必打斷使用者挑選
    } finally {
      setPreviewing(null)
    }
  }

  function choose(v: PickerVoice) {
    if (v.source === 'google' && v.googleName) saveGoogleVoicePref(language, v.googleName)
    else if (v.deviceVoice) saveVoicePref(language, v.deviceVoice.voiceURI)
    setSelectedId(v.id)
    onChanged?.()
    void preview(v)
  }

  function useAuto() {
    clearVoicePref(language)
    setSelectedId(null)
    onChanged?.()
  }

  const hint = installHint()
  const loading = deviceVoices === null || cloudVoices === null
  /** 自動挑選實際會用到哪一個——講清楚才不會讓人以為「自動」等於「隨便」 */
  const autoPick = cloudItems[0] ?? deviceItems[0] ?? null

  function renderCard(v: PickerVoice) {
    const isSelected = selectedId === v.id
    return (
      <div
        key={v.id}
        className={`flex items-center gap-3 rounded-2xl p-4 ring-1 ${
          isSelected ? 'bg-teal-50 ring-2 ring-teal-500' : 'bg-white ring-slate-200'
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 font-semibold">
            <span className="break-words">{v.label}</span>
            {v.gender && (
              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-700">
                {GENDER_LABELS[v.gender]}
              </span>
            )}
            {v.tier && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  isTopTier(v.tier) ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {TIER_LABELS[v.tier]}
              </span>
            )}
            {v.source === 'device' && v.deviceVoice && isHighQuality(v.deviceVoice) && (
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                自然
              </span>
            )}
            {v.source === 'device' && v.deviceVoice && isPoorQuality(v.deviceVoice) && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                機械感重
              </span>
            )}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {accentOf(v.langCode).label}・{v.langCode}
            {v.source === 'device' && v.deviceVoice && (v.deviceVoice.localService ? '・離線' : '・線上')}
          </p>
        </div>
        <button
          onClick={() => void preview(v)}
          aria-label={`試聽 ${v.label}`}
          className="h-11 w-11 shrink-0 rounded-full bg-slate-100 text-lg active:bg-slate-200"
        >
          {previewing === v.id ? '⏸' : '🔊'}
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
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white p-6 pb-10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-slate-200" />
        <h2 className="mt-4 text-xl font-bold">{language}發音設定</h2>
        <p className="mt-1 text-sm text-slate-500">
          點右邊的 🔊 試聽，覺得順耳就按「使用」。
        </p>

        {loading && <p className="mt-6 text-center text-slate-400">讀取可用語音…</p>}

        {!loading && allItems.length === 0 && (
          <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-700">
            這台裝置沒有找到{language}語音，會使用瀏覽器預設的聲音。可以參考下面的說明安裝。
          </p>
        )}

        {!loading && allItems.length > 0 && (
          <>
            {/* 自動挑選放在篩選條件之上：它是「不指定，讓 App 自己選最自然的」，
                不受下面的口音／聲音篩選影響，擺在一起會讓人以為它也被篩過 */}
            <button
              onClick={useAuto}
              className={`mt-4 w-full rounded-2xl p-4 text-left ring-1 ${
                selectedId === null ? 'bg-teal-50 ring-2 ring-teal-500' : 'bg-white ring-slate-200'
              }`}
            >
              <span className="font-bold">自動挑選（推薦）</span>
              <span className="mt-0.5 block text-sm text-slate-500">
                不指定口音，自動用最自然的：
                {autoPick ? `${autoPick.label}${autoPick.source === 'google' ? '（雲端語音）' : ''}` : '瀏覽器預設'}
              </span>
            </button>

            <p className="mt-4 text-xs font-semibold text-slate-500">或自己指定一個</p>

            {accents.length > 1 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-slate-500">口音</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {[{ code: ALL, label: '全部' }, ...accents].map((a) => (
                    <button
                      key={a.code}
                      onClick={() => setAccentFilter(a.code)}
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                        accentFilter === a.code ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {genders.length > 1 && (
              <div className="mt-3">
                <p className="text-xs font-semibold text-slate-500">聲音</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {([ALL, ...genders] as Array<VoiceGender | typeof ALL>).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGenderFilter(g)}
                      className={`rounded-full px-3 py-1.5 text-sm font-semibold ${
                        genderFilter === g ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {g === ALL ? '全部' : GENDER_LABELS[g]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {shownCloud.length === 0 && shownDevice.length === 0 && (
              <p className="mt-3 rounded-2xl bg-slate-50 p-4 text-center text-sm text-slate-500">
                這個條件下沒有可用的語音，換個口音或聲音試試
              </p>
            )}

            {featuredCloud.length > 0 && (
              <>
                <p className="mt-5 text-sm font-bold text-slate-700">☁️ 雲端語音</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  最接近真人的一批，每台手機聽到的都一樣。需要網路，第一次播放會慢一點點。
                </p>
                <div className="mt-2 grid gap-2">{featuredCloud.map(renderCard)}</div>
              </>
            )}

            {featuredDevice.length > 0 && (
              <>
                <p className="mt-5 text-sm font-bold text-slate-700">📱 這台裝置的語音</p>
                <p className="mt-0.5 text-xs text-slate-400">
                  不需要網路，但品質看這台裝置裝了哪些語音包，換一台可能就不一樣。
                </p>
                <div className="mt-2 grid gap-2">{featuredDevice.map(renderCard)}</div>
              </>
            )}

            {hiddenCount > 0 && (
              <>
                <button
                  onClick={() => setShowMore(!showMore)}
                  aria-expanded={showMore}
                  className="mt-6 flex w-full items-center justify-between rounded-2xl bg-slate-50 px-4 py-3.5 text-left"
                >
                  <span className="text-sm font-bold text-slate-600">
                    其他語音（{hiddenCount}）
                  </span>
                  <span className="text-slate-400">{showMore ? '▲' : '▼'}</span>
                </button>

                {showMore && (
                  <>
                    {restCloud.length > 0 && (
                      <>
                        <p className="mt-4 text-sm font-bold text-slate-700">☁️ 其他雲端音色</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          一樣是雲端合成，但自然度沒有上面那批好。
                        </p>
                        <div className="mt-2 grid gap-2">{restCloud.map(renderCard)}</div>
                      </>
                    )}

                    {hiddenDevice.length > 0 && (
                      <>
                        <p className="mt-5 text-sm font-bold text-slate-700">📱 這台裝置的語音</p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          不需要網路，但品質看這台裝置裝了哪些語音包，換一台可能就不一樣。
                        </p>
                        <div className="mt-2 grid gap-2">{hiddenDevice.map(renderCard)}</div>
                      </>
                    )}

                    {hint && (
                      <div className="mt-4 rounded-2xl bg-sky-50 p-4 ring-1 ring-sky-100">
                        <p className="font-semibold text-sky-800">
                          想讓「這台裝置的語音」更自然？（{hint.platform}）
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-sky-700">{hint.steps}</p>
                        <p className="mt-2 text-xs text-sky-600">
                          裝好之後回到這頁重新整理，新的聲音就會出現在清單裡。
                          {cloudPossible && '（雲端語音不受這個影響，本來就已經是最自然的。）'}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {/* 完全沒有可用語音時，安裝指引是唯一有用的資訊，不能藏在摺疊區裡 */}
        {!loading && allItems.length === 0 && hint && (
          <div className="mt-5 rounded-2xl bg-sky-50 p-4 ring-1 ring-sky-100">
            <p className="font-semibold text-sky-800">怎麼裝語音？（{hint.platform}）</p>
            <p className="mt-1 text-sm leading-relaxed text-sky-700">{hint.steps}</p>
            <p className="mt-2 text-xs text-sky-600">
              裝好之後回到這頁重新整理，新的聲音就會出現在清單裡。
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
