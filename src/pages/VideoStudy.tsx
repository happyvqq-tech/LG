// 影片精聽
//
// 這一頁要回答的問題只有一個：**為什麼每個字都懂，連起來卻聽不懂。**
//
// 所以版面重心跟歌曲那頁相反。歌曲先給逐行「能不能拿去用」（旋律會扭曲語言），
// 影片則是先給連音與脫落——真實口語本來就能用，問題在於字典上的
// what do you 在嘴裡是 whaddaya、〜ている 是〜てる，學習者背過的形狀
// 根本沒有以他認得的樣子出現過。
//
// 三個設計決定：
//
// 1. 每一行可以直接播那幾秒的真實聲音。這是影片相對於文字教材唯一的優勢，
//    不用就沒意義了——逐字稿的時間戳是 YouTube 自己給的，不像歌詞要校正
// 2. 難聽懂的那幾行展開後，可以把「真實聲音」跟 TTS 的「標準唸法」並排比。
//    單聽真實聲音學不到東西，要跟自己腦中那個形狀對照才知道差在哪
// 3. 填充詞明講「可以當雜訊跳過」。學習者卡住常常是因為想去解讀 you know
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { getVideo, readVideoLesson } from '../lib/videoService'
import { clipRange, matchTimes, parseTranscript, type TranscriptLine } from '../lib/transcript'
import { harvestFromTask } from '../lib/vocabService'
import { logActivity } from '../lib/streakService'
import { speak, stopSpeaking } from '../lib/speech'
import type { VideoLesson, VideoLine } from '../lib/prompts/video'
import type { Language, Video } from '../lib/types'

/** 把秒數寫成 1:05，給播放按鈕用 */
function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function LineRow({
  line,
  time,
  language,
  onPlay,
}: {
  line: VideoLine
  time: number | null
  language: Language
  onPlay: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <li className="list-none border-t border-slate-100 py-3 first:border-t-0">
      <div className="flex items-start gap-2.5">
        <span
          title={line.tricky ? '這句聽起來跟字面差很多' : '這句照字面就聽得懂'}
          className={`mt-0.5 shrink-0 text-sm ${line.tricky ? 'text-amber-500' : 'text-slate-200'}`}
        >
          {line.tricky ? '⚠️' : '・'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base leading-relaxed text-slate-800">{line.text}</p>
          {line.zh && <p className="mt-0.5 text-sm text-slate-500">{line.zh}</p>}

          {line.tricky && (
            <button onClick={() => setOpen((v) => !v)} className="mt-1 text-xs font-semibold text-amber-700">
              {open ? '收起' : '實際聽起來是？'}
            </button>
          )}
          {line.tricky && open && (
            <div className="mt-1.5 rounded-xl bg-amber-50 p-3">
              {line.heard && <p className="text-sm font-semibold text-amber-900">聽起來像：{line.heard}</p>}
              {line.note && <p className="mt-1 text-xs leading-relaxed text-amber-800/80">{line.note}</p>}
              {!line.heard && !line.note && (
                <p className="text-xs text-amber-800/80">這句連著講會黏在一起，放慢聽一次就會分出來。</p>
              )}
              {/* 真實聲音要跟腦中那個形狀對照才學得到東西，所以標準唸法放在這裡 */}
              <button
                onClick={() => void speak(line.text, language).catch(() => undefined)}
                className="mt-2 w-full rounded-lg bg-white py-2 text-xs font-semibold text-amber-800 ring-1 ring-amber-200"
              >
                🔊 聽一次標準唸法（跟上面的實際發音比）
              </button>
            </div>
          )}
        </div>
        {/* 播單句是這一頁的主要動作（不像歌曲那邊只是輔助），
            所以給足 44px 的觸控目標，不能是個灰灰的小符號 */}
        <button
          onClick={onPlay}
          aria-label={time === null ? '唸這一句' : '播這一句的原聲'}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-50 text-teal-600 ring-1 ring-slate-200/70 active:bg-slate-100"
        >
          {time === null ? '🔊' : '▶︎'}
        </button>
      </div>
    </li>
  )
}

export default function VideoStudy() {
  const { videoId } = useParams()
  const navigate = useNavigate()
  const { profile } = useProfile()
  const [video, setVideo] = useState<Video | null>(null)
  const [lesson, setLesson] = useState<VideoLesson | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile || !videoId) return
    let alive = true
    getVideo(videoId, profile.id)
      .then((v) => {
        if (!alive) return
        setVideo(v)
        if (v) setLesson(readVideoLesson(v))
      })
      .catch(() => alive && setVideo(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [profile, videoId])

  if (!profile) return null
  if (loading) return <p className="p-10 text-center text-slate-400">載入中…</p>

  if (!video || !lesson) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p className="mt-10 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/60">
          <span className="block font-semibold text-slate-700">這支影片的教材讀不到</span>
          <span className="mt-2 block text-sm text-slate-500">
            可能是生成時被截斷了。回影片清單把它刪掉重做一次就好。
          </span>
        </p>
        <button
          onClick={() => navigate('/video')}
          className="mt-4 w-full rounded-xl bg-teal-600 py-3 font-bold text-white"
        >
          回影片清單
        </button>
      </main>
    )
  }

  return <VideoLessonView video={video} lesson={lesson} profileId={profile.id} />
}

/**
 * 教材本體。刻意跟上面的讀取分開：這樣版面可以餵固定資料單獨渲染檢查，
 * 不必真的生成一支教材才看得到長什麼樣。
 */
export function VideoLessonView({
  video,
  lesson,
  profileId,
}: {
  video: Video
  lesson: VideoLesson
  profileId: string
}) {
  const navigate = useNavigate()
  const [harvested, setHarvested] = useState<number | null>(null)
  const harvestingRef = useRef(false)

  /** 目前要播的區間；token 每按一次 +1，用來重掛 iframe 讓它從指定秒數重播 */
  const [clip, setClip] = useState<{ start: number; end: number | null; token: number } | null>(null)

  useEffect(() => stopSpeaking, [])

  const parsed: TranscriptLine[] = useMemo(() => parseTranscript(video.transcript), [video])

  /** 教材每一行對回影片的秒數；對不到就是 null（那行只能用 TTS） */
  const times = useMemo(
    () => matchTimes(lesson.lines.map((l) => l.text), parsed),
    [lesson, parsed],
  )

  const range = useMemo(() => clipRange(times, parsed), [times, parsed])

  /** 這一句播到哪裡停：逐字稿的下一行開始處，沒有下一行就給 8 秒 */
  function lineEnd(start: number): number {
    const after = parsed.find((l) => l.time !== null && l.time > start)
    return after?.time ?? start + 8
  }

  function play(start: number, end: number | null) {
    stopSpeaking()
    setClip((c) => ({ start, end, token: (c?.token ?? 0) + 1 }))
  }

  function playLine(i: number) {
    const t = times[i]
    if (t === null || t === undefined) {
      void speak(lesson.lines[i].text, video.language).catch(() => undefined)
      return
    }
    play(Math.max(0, t - 0.3), lineEnd(t))
  }

  async function harvest() {
    if (harvestingRef.current || lesson.chunks.length === 0) return
    harvestingRef.current = true
    const n = await harvestFromTask(
      profileId,
      video.language,
      lesson.chunks.map((c) => ({ word: c.text, meaning_zh: c.zh, example: c.usage })),
    ).catch(() => 0)
    setHarvested(n)
    void logActivity(profileId).catch(() => undefined)
    harvestingRef.current = false
  }

  const src =
    clip === null
      ? null
      : `https://www.youtube-nocookie.com/embed/${video.youtube_id}` +
        `?autoplay=1&playsinline=1&rel=0&start=${Math.floor(clip.start)}` +
        (clip.end === null ? '' : `&end=${Math.ceil(clip.end)}`)

  return (
    <main className="mx-auto max-w-xl p-6 pb-16 lg:max-w-3xl">
      <header className="flex items-center justify-between pt-2">
        <h1 className="min-w-0 truncate text-xl font-bold">{video.title}</h1>
        <Link
          to="/video"
          onClick={stopSpeaking}
          className="shrink-0 rounded-full px-4 py-2 text-sm text-slate-500 active:bg-slate-100"
        >
          返回
        </Link>
      </header>

      {lesson.gist && (
        <p className="mt-3 rounded-2xl bg-white p-4 text-sm leading-relaxed text-slate-600 shadow-sm ring-1 ring-slate-200/60">
          {lesson.gist}
        </p>
      )}

      <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
        {src && (
          <div className="mb-3 overflow-hidden rounded-xl bg-black">
            <iframe
              key={clip?.token}
              title="影片"
              className="aspect-video w-full"
              src={src}
              allow="autoplay; encrypted-media"
              allowFullScreen
            />
          </div>
        )}
        <button
          onClick={() => play(range ? range.start : 0, range ? range.end : null)}
          className="w-full rounded-xl bg-rose-50 py-3 font-bold text-rose-700"
        >
          {range ? `▶︎ 播這一段（${mmss(range.start)}–${mmss(range.end)}）` : '▶︎ 播放影片'}
        </button>
        {range ? (
          <p className="mt-2 text-center text-xs text-slate-400">
            下面每一句都可以單獨播，反覆聽同一句才聽得出連音在哪裡斷
          </p>
        ) : (
          <p className="mt-2 text-center text-xs text-slate-400">
            逐字稿沒有時間戳，只能從頭播。下次複製時把 YouTube 的時間戳一起帶上就能分句播
          </p>
        )}
      </section>

      {/* 連音與脫落放在最前面：聽不懂母語者講話，九成是這個而不是單字不夠 */}
      {lesson.reductions.length > 0 && (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="font-bold text-slate-800">這段的連音與脫落</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            字典上的形狀跟嘴裡的形狀不一樣。先認得這些，整句才不會崩掉
          </p>
          <ul className="mt-3 space-y-2.5">
            {lesson.reductions.map((r, i) => (
              <li key={i} className="text-sm">
                <span className="text-slate-500">{r.written}</span>
                <span className="mx-1.5 text-slate-300">→</span>
                <span className="font-bold text-slate-800">{r.spoken}</span>
                {r.note && <span className="mt-0.5 block text-xs text-slate-500">{r.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <h3 className="font-bold text-slate-800">逐句精聽（{lesson.lines.length} 句）</h3>
        <p className="mt-0.5 text-xs text-slate-500">⚠️ 標的是「聽起來跟字面差很多」的句子</p>
        <ul className="mt-2">
          {lesson.lines.map((l, i) => (
            <LineRow
              key={i}
              line={l}
              time={times[i] ?? null}
              language={video.language}
              onPlay={() => playLine(i)}
            />
          ))}
        </ul>
      </section>

      {/* 填充詞：知道「這是在拖時間、可以跳過」本身就是一種聽力技能 */}
      {lesson.fillers.length > 0 && (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="font-bold text-slate-800">這些是雜訊，可以跳過</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            它們沒有字典意義。想去解讀就會跟不上後面的內容——直接當成停頓
          </p>
          {/* 一行一個：說明文字長度差很多，排成 flex-wrap 會參差不齊很難掃 */}
          <ul className="mt-3 space-y-1.5">
            {lesson.fillers.map((f, i) => (
              <li key={i} className="flex items-baseline gap-2.5 rounded-xl bg-slate-50 px-3 py-2">
                <span className="shrink-0 text-sm font-bold text-slate-700">{f.word}</span>
                {f.role && <span className="min-w-0 text-xs leading-relaxed text-slate-500">{f.role}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {lesson.accent && (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="font-bold text-slate-800">這個人的腔調</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{lesson.accent}</p>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            腔調不是「口音很重」，是有規則的。弄懂一條就聽得懂一整類人講話
          </p>
        </section>
      )}

      {lesson.chunks.length > 0 && (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="font-bold text-slate-800">可以帶走的語塊（{lesson.chunks.length}）</h3>
          <ul className="mt-3 space-y-2.5">
            {lesson.chunks.map((c, i) => (
              <li key={i}>
                <p className="font-semibold text-teal-700">{c.text}</p>
                <p className="text-sm text-slate-500">{c.zh}</p>
                {c.usage && <p className="text-xs text-slate-400">{c.usage}</p>}
              </li>
            ))}
          </ul>
          <button
            onClick={() => void harvest()}
            disabled={harvested !== null}
            className="mt-3 w-full rounded-xl bg-teal-600 py-3 font-bold text-white disabled:opacity-60"
          >
            {harvested === null ? '加進單字庫複習' : `已加入 ${harvested} 個，之後會自動排複習`}
          </button>
        </section>
      )}

      <button
        onClick={() => {
          stopSpeaking()
          navigate('/video')
        }}
        className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 font-bold text-white"
      >
        聽完了
      </button>
    </main>
  )
}
