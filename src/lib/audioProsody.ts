// 語調節奏比對：把兩段錄音的音高曲線與能量起伏拿來對齊比較，算出相似度。
//
// 為什麼台語要自己算，不像英日韓那樣用 prosodyScore.ts：
// 那支是靠瀏覽器 SpeechRecognition 把使用者說的話轉成文字再比對，而
// SpeechRecognition 沒有台語。硬用 zh-TW 會把台語辨識成一堆不相干的國語詞，
// 分數毫無意義。所以台語改成直接比聲音本身——這其實更貼近「跟讀」的本意：
// 比的是語調與節奏像不像，不是用字對不對。
//
// 本檔全部是純函式（吃 Float32Array 吐數字），不碰 Web Audio API，
// 才能用 tsx 直接跑單元測試。解碼音檔的部分在 audioCapture.ts。

/** 台語（以及一般人聲）的基頻範圍，超出這個範圍的都當成雜訊 */
const MIN_F0_HZ = 70
const MAX_F0_HZ = 400

/** 分析窗長與位移。40ms 的窗在 16kHz 下有 640 點，足夠涵蓋 70Hz 的一個週期。 */
const FRAME_MS = 40
const HOP_MS = 20

export interface ProsodyScoreResult {
  /** 0-100 綜合分數 */
  score: number
  /** 音高曲線相似度 0-1（語調像不像） */
  pitchSim: number
  /** 能量起伏相似度 0-1（輕重快慢的節奏像不像） */
  rhythmSim: number
  /** 長度接近度 0-1（有沒有唸得太快或太拖） */
  durationSim: number
  /** 使用者這段有沒有偵測到足夠的人聲 */
  hasVoice: boolean
}

/** 跟讀過關門檻，與英日韓的 prosodyScore.ts 一致 */
export const TAIGI_PASS_THRESHOLD = 80

// ---------------- 基本訊號處理 ----------------

/** 每一格的均方根音量（能量包絡） */
export function frameRms(samples: Float32Array, frameSize: number, hop: number): number[] {
  const out: number[] = []
  if (frameSize <= 0 || hop <= 0) return out
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    let sum = 0
    for (let i = start; i < start + frameSize; i++) sum += samples[i] * samples[i]
    out.push(Math.sqrt(sum / frameSize))
  }
  return out
}

/**
 * 單一格的基頻偵測：正規化自相關（NSDF 的簡化版）。
 * 找不到夠可信的週期時回 0，代表這格是無聲或子音。
 */
export function detectPitchHz(
  frame: Float32Array,
  sampleRate: number,
  minHz = MIN_F0_HZ,
  maxHz = MAX_F0_HZ,
): number {
  const n = frame.length
  const minLag = Math.floor(sampleRate / maxHz)
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / minHz))
  if (maxLag <= minLag) return 0

  // 去掉直流偏移，否則自相關會被一個常數項主導
  let mean = 0
  for (let i = 0; i < n; i++) mean += frame[i]
  mean /= n
  const x = new Float32Array(n)
  let energy = 0
  for (let i = 0; i < n; i++) {
    x[i] = frame[i] - mean
    energy += x[i] * x[i]
  }
  // 太安靜就不用算了，算出來也是雜訊的週期
  if (energy / n < 1e-6) return 0

  let bestLag = 0
  let bestScore = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i + lag < n; i++) {
      corr += x[i] * x[i + lag]
      normA += x[i] * x[i]
      normB += x[i + lag] * x[i + lag]
    }
    const denom = Math.sqrt(normA * normB)
    if (denom <= 0) continue
    const score = corr / denom
    // 週期的 2 倍、3 倍相關性一樣高（低八度誤判），所以由小到大掃、
    // 且要「明顯更好」才換人。少了這個 margin，音高會隨機掉一個八度，
    // 半音曲線就整段偏掉 12 個半音，分數完全不能看。
    if (score > bestScore + 0.02) {
      bestScore = score
      bestLag = lag
    }
  }
  // 0.5 以下的相關性通常是氣音或雜訊，不採信
  if (bestLag === 0 || bestScore < 0.5) return 0
  return sampleRate / bestLag
}

/**
 * 降取樣（取區塊平均，順便當粗糙的抗混疊低通）。
 *
 * 手機錄音多半是 48kHz，直接在原取樣率上做自相關，每一格要掃的 lag 數量
 * 是 16kHz 的三倍、每個 lag 的長度也是三倍——同一句話會慢上快十倍，
 * 使用者按完「唸完了」要等好幾秒。基頻只到 400Hz，16kHz 綽綽有餘。
 */
export function downsampleTo(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): { samples: Float32Array; sampleRate: number } {
  if (fromRate <= toRate) return { samples, sampleRate: fromRate }
  const factor = Math.floor(fromRate / toRate)
  const outLen = Math.floor(samples.length / factor)
  const out = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    let sum = 0
    for (let j = 0; j < factor; j++) sum += samples[i * factor + j]
    out[i] = sum / factor
  }
  return { samples: out, sampleRate: fromRate / factor }
}

/** 音高分析用的取樣率：人聲基頻最高 400Hz，16kHz 遠遠夠用 */
const PITCH_ANALYSIS_RATE = 16000

/** 整段的音高軌跡，0 表示該格無聲 */
export function pitchTrack(samples: Float32Array, sampleRate: number): number[] {
  const frameSize = Math.round((FRAME_MS / 1000) * sampleRate)
  const hop = Math.round((HOP_MS / 1000) * sampleRate)
  const out: number[] = []
  if (frameSize <= 0 || hop <= 0) return out
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    out.push(detectPitchHz(samples.subarray(start, start + frameSize), sampleRate))
  }
  return out
}

/**
 * 把音高軌跡轉成「相對於自己中位數的半音數」。
 *
 * 這一步是整個評分能不能用的關鍵：AI 是女聲、使用者可能是男聲，基頻差一個
 * 八度以上。比絕對頻率的話，唸得再像分數都是零。改比相對起伏之後，
 * 男聲跟著女聲唸出同樣的抑揚，就會拿到高分——這才是跟讀要練的東西。
 *
 * 無聲的格子直接捨棄（停頓的比較交給能量包絡與長度）。
 */
export function toSemitoneContour(hz: number[]): number[] {
  const voiced = hz.filter((f) => f > 0)
  if (voiced.length === 0) return []
  const sorted = [...voiced].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  if (median <= 0) return []
  return voiced.map((f) => 12 * Math.log2(f / median))
}

/** 正規化能量包絡：除以最大值，只留形狀不留音量（麥克風增益不同不該扣分） */
export function normalizeEnvelope(env: number[]): number[] {
  const max = env.reduce((m, v) => (v > m ? v : m), 0)
  if (max <= 0) return env.map(() => 0)
  return env.map((v) => v / max)
}

/**
 * DTW（動態時間規整）距離，回傳「沿最佳路徑的平均每步距離」。
 *
 * 用 DTW 而不是逐格相減，是因為使用者一定不會跟 AI 完全同步起跑，
 * 中間也會有快有慢。DTW 允許時間軸伸縮，比的是曲線形狀本身。
 */
export function dtwDistance(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return Infinity
  const n = a.length
  const m = b.length
  // cost[j] 是上一列，cur[j] 是這一列——只留兩列，長句子也不會吃掉記憶體
  let prev = new Float64Array(m + 1).fill(Infinity)
  let cur = new Float64Array(m + 1).fill(Infinity)
  // steps 同步記錄路徑長度，用來把總距離平均掉（長句子不該天生分數低）
  let prevSteps = new Float64Array(m + 1)
  let curSteps = new Float64Array(m + 1)
  prev[0] = 0

  for (let i = 1; i <= n; i++) {
    cur[0] = Infinity
    curSteps[0] = 0
    for (let j = 1; j <= m; j++) {
      const cost = Math.abs(a[i - 1] - b[j - 1])
      let best = prev[j - 1]
      let bestSteps = prevSteps[j - 1]
      if (prev[j] < best) {
        best = prev[j]
        bestSteps = prevSteps[j]
      }
      if (cur[j - 1] < best) {
        best = cur[j - 1]
        bestSteps = curSteps[j - 1]
      }
      cur[j] = best + cost
      curSteps[j] = bestSteps + 1
    }
    const t = prev
    prev = cur
    cur = t
    const ts = prevSteps
    prevSteps = curSteps
    curSteps = ts
  }
  const total = prev[m]
  const steps = prevSteps[m]
  if (!Number.isFinite(total) || steps <= 0) return Infinity
  return total / steps
}

/**
 * 把距離換成 0~1 的相似度：距離 0 得 1 分，到達 scale 得 0 分。
 * scale 就是「差到這個程度算完全不像」的門檻。
 */
export function similarityFromDistance(distance: number, scale: number): number {
  if (!Number.isFinite(distance) || scale <= 0) return 0
  return Math.max(0, Math.min(1, 1 - distance / scale))
}

/**
 * 長度接近度：用倍數的對數算，快兩倍和慢兩倍扣一樣多分。
 * 差到 2 倍（或 1/2）時歸零。
 */
export function durationCloseness(aiMs: number, userMs: number): number {
  if (aiMs <= 0 || userMs <= 0) return 0
  const ratio = userMs / aiMs
  const octaves = Math.abs(Math.log2(ratio))
  return Math.max(0, 1 - octaves)
}

// ---------------- 綜合評分 ----------------

export interface ProsodyInput {
  aiSamples: Float32Array
  aiSampleRate: number
  userSamples: Float32Array
  userSampleRate: number
}

/**
 * 音高曲線的容忍範圍（半音）。跟讀得好的人平均偏差約 1~2 個半音，
 * 差到 6 個半音（半個八度）就是完全沒跟上語調了。
 */
const PITCH_SCALE_SEMITONES = 6
/** 能量包絡已正規化到 0~1，平均差 0.5 視為完全不像 */
const RHYTHM_SCALE = 0.5

export function computeProsodyScore(input: ProsodyInput): ProsodyScoreResult {
  const aiLow = downsampleTo(input.aiSamples, input.aiSampleRate, PITCH_ANALYSIS_RATE)
  const userLow = downsampleTo(input.userSamples, input.userSampleRate, PITCH_ANALYSIS_RATE)
  const aiPitch = toSemitoneContour(pitchTrack(aiLow.samples, aiLow.sampleRate))
  const userPitch = toSemitoneContour(pitchTrack(userLow.samples, userLow.sampleRate))

  const aiFrame = Math.round((FRAME_MS / 1000) * input.aiSampleRate)
  const aiHop = Math.round((HOP_MS / 1000) * input.aiSampleRate)
  const userFrame = Math.round((FRAME_MS / 1000) * input.userSampleRate)
  const userHop = Math.round((HOP_MS / 1000) * input.userSampleRate)
  const aiEnv = normalizeEnvelope(frameRms(input.aiSamples, aiFrame, aiHop))
  const userEnv = normalizeEnvelope(frameRms(input.userSamples, userFrame, userHop))

  // 少於 3 格有聲代表根本沒錄到人聲（沒說話、麥克風沒開、全是氣音）
  const hasVoice = userPitch.length >= 3
  if (!hasVoice) {
    return { score: 0, pitchSim: 0, rhythmSim: 0, durationSim: 0, hasVoice: false }
  }

  const pitchSim = similarityFromDistance(dtwDistance(aiPitch, userPitch), PITCH_SCALE_SEMITONES)
  const rhythmSim = similarityFromDistance(dtwDistance(aiEnv, userEnv), RHYTHM_SCALE)
  const durationSim = durationCloseness(
    (input.aiSamples.length / input.aiSampleRate) * 1000,
    (input.userSamples.length / input.userSampleRate) * 1000,
  )

  // 語調是乘數而不是加項：三項相加的話，只要節奏與長度對上就能拿到五十幾分，
  // 語調完全沒跟上也可能過關（測試裡真的出現過 85 分的亂唸）。改成乘法之後，
  // 語調不像就整體壓低，節奏與長度只能在語調有跟上的前提下加分。
  const raw = pitchSim * (0.65 + 0.25 * rhythmSim + 0.1 * durationSim)
  return {
    score: Math.round(raw * 100),
    pitchSim,
    rhythmSim,
    durationSim,
    hasVoice: true,
  }
}
