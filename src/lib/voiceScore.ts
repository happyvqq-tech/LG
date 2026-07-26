// 語音品質評分——純函式，方便單元測試
//
// 為什麼需要這個：瀏覽器 speechSynthesis 在同一台裝置上常常同時提供
// 「很自然的網路語音」與「很機械的離線語音」，預設選到哪個完全看瀏覽器心情。
// 之前只比對名字裡有沒有 natural/google/microsoft，結果：
//   1. 完全沒看 localService——網路語音（localService=false）幾乎一定比離線好
//   2. 沒排除已知的爛語音（macOS 的 Zarvox/Fred 等惡搞音效、eSpeak、iOS compact）
//      這些名字不含任何關鍵字，反而會以 0.5 分「勝出」，聽起來就是機器人
//
// 這裡只需要 name/lang/localService 三個欄位，測試時不必偽造整個
// SpeechSynthesisVoice（那是瀏覽器原生物件，無法用普通物件冒充）。
export interface VoiceLike {
  name: string
  lang: string
  localService: boolean
  voiceURI: string
}

/** 微軟 Edge 的 Neural/Natural 系列，目前瀏覽器內建語音裡最自然的一批 */
const TIER_BEST = /natural|neural/i
/** 名字明示是線上語音的（Edge 的 "... Online (Natural)"） */
const TIER_ONLINE = /online/i
/** Google TTS、Apple Siri／加強版語音，品質明顯優於基本款 */
const TIER_GOOD = /google|siri|enhanced|premium/i

/**
 * 明確要避開的語音：
 * - compact：iOS 未下載加強版時的壓縮語音，聽起來最像機器人
 * - espeak/festival/pico/flite：Linux/Android 上的合成器，非常機械
 * - macOS 惡搞語音：Zarvox、Bells、Boing 這類是給玩的，拿來學語言會出事
 * - Windows 舊版 David/Zira/Hazel：SAPI5 老引擎，比 Edge Natural 差一大截
 */
const TIER_AVOID =
  /compact|espeak|festival|\bpico\b|\bflite\b|zarvox|trinoids|whisper|wobble|bahh|bells|boing|bubbles|cellos|deranged|hysterical|jester|organ|superstar|good news|bad news|albert|\bfred\b|junior|ralph|kathy|grandma|grandpa|rocko|shelley|sandy|eddy|reed|\bflo\b/i
/** Windows 舊 SAPI 語音：能用但明顯不自然，只在沒有更好選擇時才用 */
const TIER_DATED = /\bdavid\b|\bzira\b|\bhazel\b|\bmark\b/i

/** 語音品質評分，分數越高越自然。純比較用，絕對值沒有意義。 */
export function scoreVoice(v: VoiceLike, langCode: string): number {
  let s = 0

  if (TIER_AVOID.test(v.name)) s -= 10
  else if (TIER_DATED.test(v.name)) s -= 2

  if (TIER_BEST.test(v.name)) s += 6
  else if (TIER_ONLINE.test(v.name)) s += 4
  else if (TIER_GOOD.test(v.name)) s += 3

  // 網路語音幾乎一定比離線語音自然；這是之前完全漏掉、影響最大的訊號
  if (!v.localService) s += 3

  // 完全符合的語系（en-US vs en-GB）優先，但只是微調，不該蓋過品質差異
  if (normalizeLang(v.lang) === normalizeLang(langCode)) s += 0.5

  return s
}

function normalizeLang(lang: string): string {
  return lang.replace('_', '-').toLowerCase()
}

/** 只保留語系前綴相符的語音（en-US 的請求也接受 en-GB） */
export function filterByLang<T extends VoiceLike>(voices: T[], langCode: string): T[] {
  const prefix = normalizeLang(langCode).slice(0, 2)
  return voices.filter((v) => normalizeLang(v.lang).startsWith(prefix))
}

/** 依品質排序（好的在前）；同分維持原順序，結果才穩定可預測 */
export function sortByQuality<T extends VoiceLike>(voices: T[], langCode: string): T[] {
  return voices
    .map((v, i) => ({ v, i, s: scoreVoice(v, langCode) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.v)
}

/** 這個語音是否屬於「應該避開」那一類，UI 上要標示出來 */
export function isPoorQuality(v: VoiceLike): boolean {
  return TIER_AVOID.test(v.name)
}

/** 這個語音是否是自然度較高的那一批，UI 上給個推薦標記 */
export function isHighQuality(v: VoiceLike): boolean {
  if (TIER_AVOID.test(v.name)) return false
  return TIER_BEST.test(v.name) || TIER_ONLINE.test(v.name) || !v.localService
}
