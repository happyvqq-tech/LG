// 錄音與音檔解碼——audioProsody.ts 的 IO 外殼。
//
// 台語沒有語音辨識可用，跟讀評分改成直接比聲音（見 audioProsody.ts 的說明），
// 所以這裡要真的把使用者的聲音錄下來，而不是像英日韓那樣拿 STT 的逐字稿。
// 錄下來的音檔同時也讓使用者可以「聽自己 vs 聽 AI」自己對照。

export class RecorderError extends Error {
  friendlyMessage: string
  constructor(message: string, friendlyMessage: string) {
    super(message)
    this.name = 'RecorderError'
    this.friendlyMessage = friendlyMessage
  }
}

export function recordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia
  )
}

/** 挑一個這台裝置真的支援的容器格式（Safari 只吃 mp4，Chrome 吃 webm） */
function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported?.(t)) return t
  }
  return undefined
}

export interface Recording {
  blob: Blob
  url: string
  /** 實際錄了多久（毫秒） */
  durationMs: number
}

/**
 * 點一下開始、再點一下結束的錄音器。
 * 刻意不做「按住說話」——手機上 pointerup 後還會補一個 pointerleave，
 * 兩個事件都綁停止會停兩次（這個坑在 VoiceChat.tsx 修過一次了）。
 */
export class AudioClipRecorder {
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private startedAt = 0

  async start(): Promise<void> {
    if (!recordingSupported()) {
      throw new RecorderError('MediaRecorder unavailable', '這個瀏覽器不支援錄音，請改用 Chrome 或 Safari')
    }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      throw new RecorderError('getUserMedia denied', '麥克風權限被拒絕，請到瀏覽器設定開啟')
    }
    this.stream = stream
    this.chunks = []
    const mimeType = pickMimeType()
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.recorder = rec
    this.startedAt = performance.now()
    rec.start()
  }

  get recording(): boolean {
    return this.recorder !== null
  }

  /** 結束錄音並取回音檔；沒在錄的時候回 null */
  stop(): Promise<Recording | null> {
    const rec = this.recorder
    if (!rec) return Promise.resolve(null)
    this.recorder = null
    const durationMs = performance.now() - this.startedAt
    return new Promise((resolve) => {
      rec.onstop = () => {
        this.releaseStream()
        const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' })
        this.chunks = []
        resolve(blob.size > 0 ? { blob, url: URL.createObjectURL(blob), durationMs } : null)
      }
      rec.stop()
    })
  }

  cancel(): void {
    const rec = this.recorder
    this.recorder = null
    this.chunks = []
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null
      rec.stop()
    }
    this.releaseStream()
  }

  /** 一定要停掉每一條 track，不然手機狀態列的錄音圖示會一直亮著 */
  private releaseStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }
}

let sharedContext: AudioContext | null = null

function getAudioContext(): AudioContext {
  if (!sharedContext) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) throw new RecorderError('AudioContext unavailable', '這個瀏覽器不支援音訊分析')
    sharedContext = new Ctor()
  }
  return sharedContext
}

export interface DecodedAudio {
  samples: Float32Array
  sampleRate: number
}

/** 把任意音檔（blob URL 或 Worker 回來的 mp3）解成單聲道取樣，餵給 audioProsody */
export async function decodeAudio(url: string): Promise<DecodedAudio> {
  const res = await fetch(url)
  const arrayBuffer = await res.arrayBuffer()
  const ctx = getAudioContext()
  const buffer = await ctx.decodeAudioData(arrayBuffer)
  return { samples: toMono(buffer), sampleRate: buffer.sampleRate }
}

/** 多聲道就取平均——比只拿左聲道穩，有些裝置只錄到單邊 */
function toMono(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0)
  const len = buffer.length
  const out = new Float32Array(len)
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < len; i++) out[i] += data[i]
  }
  for (let i = 0; i < len; i++) out[i] /= buffer.numberOfChannels
  return out
}
