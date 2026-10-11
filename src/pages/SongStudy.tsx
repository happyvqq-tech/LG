// 歌曲分段學習
//
// 一次只學一段（副歌或一段主歌），不是整首四分鐘攤開來——那是歌詞本不是課。
//
// 這一頁有三個東西是其他歌曲 App 沒做好的：
//
// 1. 每一行標「能不能拿去用」。歌詞為了押韻與音節數會刪助詞、倒裝、用文語，
//    照著歌詞講話會很怪。只給「歌詞＋翻譯」的 App 會讓學習者把歌詞當成
//    這個語言本來的樣子學走。
// 2. 只循環播這一段。學一首歌有效的練法不是從頭聽到尾，是把十幾秒的一句
//    反覆聽到嘴巴跟得上——有逐句時間戳才做得到。
// 3. 唱 vs 說的語調對照。唱歌會破壞英文重音與日文音高重音（日文靠音高
//    分辨「雨」和「飴」，而唱歌時音高由旋律決定）。只靠歌學的人會把錯的
//    節奏與音高一起練進去，而且定型之後極難改。所以「說的版本」是矯正器。
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { getSong, parseYouTubeId, readLesson, saveSegmentIndex, saveVideoId } from '../lib/songService'
import { matchLineTimes, parseLrc, segmentRange } from '../lib/lrc'
import { harvestFromTask } from '../lib/vocabService'
import { logActivity } from '../lib/streakService'
import { speak, stopSpeaking } from '../lib/speech'
import type { SongLesson, SongLine } from '../lib/prompts/song'
import type { Song } from '../lib/types'

/** 影片與歌詞時間戳的落差（影片有片頭時會需要），每首各記各的 */
function offsetKey(songId: string): string {
  return `lgl.songOffset.${songId}`
}

function loadOffset(songId: string): number {
  try {
    return Number(localStorage.getItem(offsetKey(songId))) || 0
  } catch {
    return 0
  }
}

function LineRow({ line, onPlay }: { line: SongLine; onPlay: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <li className="list-none border-t border-slate-100 py-3 first:border-t-0">
      <div className="flex items-start gap-2.5">
        <span
          title={line.usable ? '可以直接拿去用' : '歌詞限定，平常不這樣講'}
          className={`mt-0.5 shrink-0 text-sm ${line.usable ? 'text-teal-600' : 'text-amber-500'}`}
        >
          {line.usable ? '✅' : '⚠️'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base leading-relaxed text-slate-800">{line.text}</p>
          {line.zh && <p className="mt-0.5 text-sm text-slate-500">{line.zh}</p>}

          {!line.usable && (
            <button onClick={() => setOpen((v) => !v)} className="mt-1 text-xs font-semibold text-amber-700">
              {open ? '收起' : '平常會怎麼講？'}
            </button>
          )}
          {!line.usable && open && (
            <div className="mt-1.5 rounded-xl bg-amber-50 p-3">
              {line.prose && <p className="text-sm font-semibold text-amber-900">{line.prose}</p>}
              {line.note && <p className="mt-1 text-xs leading-relaxed text-amber-800/80">{line.note}</p>}
              {!line.prose && !line.note && (
                <p className="text-xs text-amber-800/80">這行是歌詞寫法，日常對話不會這樣說。</p>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onPlay}
          aria-label="唸這一句"
          className="shrink-0 rounded-full px-2 text-slate-300 active:bg-slate-100"
        >
          🔊
        </button>
      </div>
    </li>
  )
}

export default function SongStudy() {
  const { songId } = useParams()
  const navigate = useNavigate()
  const { profile } = useProfile()
  const [song, setSong] = useState<Song | null>(null)
  const [lesson, setLesson] = useState<SongLesson | null>(null)
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [harvested, setHarvested] = useState<number | null>(null)
  const harvestingRef = useRef(false)

  const [videoId, setVideoId] = useState('')
  const [videoInput, setVideoInput] = useState('')
  const [offset, setOffset] = useState(0)
  /** 每按一次播放就 +1，用來重掛 iframe 讓它從指定秒數重播 */
  const [playToken, setPlayToken] = useState(0)

  useEffect(() => {
    if (!profile || !songId) return
    let alive = true
    getSong(songId, profile.id)
      .then((s) => {
        if (!alive) return
        setSong(s)
        if (s) {
          setLesson(readLesson(s))
          setIndex(s.segment_index ?? 0)
          setVideoId(s.youtube_id ?? '')
          setOffset(loadOffset(s.id))
        }
      })
      .catch(() => alive && setSong(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [profile, songId])

  useEffect(() => stopSpeaking, [])

  const lrc = useMemo(() => (song?.synced ? parseLrc(song.synced) : []), [song])

  const seg = lesson && lesson.segments.length > 0
    ? lesson.segments[Math.min(Math.max(index, 0), lesson.segments.length - 1)]
    : null

  /** 這一段在原曲裡的起訖秒數；沒有同步歌詞或對不到就是 null */
  const range = useMemo(() => {
    if (!seg || lrc.length === 0) return null
    return segmentRange(matchLineTimes(seg.lines.map((l) => l.text), lrc), lrc)
  }, [seg, lrc])

  if (!profile) return null
  if (loading) return <p className="p-10 text-center text-slate-400">載入中…</p>

  if (!song || !lesson || !seg) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p className="mt-10 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/60">
          <span className="block font-semibold text-slate-700">這首歌的教材讀不到</span>
          <span className="mt-2 block text-sm text-slate-500">
            可能是生成時被截斷了。回歌單把它刪掉重做一次就好。
          </span>
        </p>
        <button
          onClick={() => navigate('/song')}
          className="mt-4 w-full rounded-xl bg-teal-600 py-3 font-bold text-white"
        >
          回歌單
        </button>
      </main>
    )
  }

  const total = lesson.segments.length
  const safeIndex = Math.min(Math.max(index, 0), total - 1)
  const last = safeIndex >= total - 1

  function go(next: number) {
    stopSpeaking()
    setPlayToken(0) // 換段就把播放器收起來，不要繼續播上一段
    const clamped = Math.min(Math.max(next, 0), total - 1)
    setIndex(clamped)
    if (song) void saveSegmentIndex(song.id, clamped)
  }

  function nudge(delta: number) {
    if (!song) return
    const next = Math.round((offset + delta) * 10) / 10
    setOffset(next)
    try {
      localStorage.setItem(offsetKey(song.id), String(next))
    } catch {
      // 存不起來就只在這次有效，不影響播放
    }
    setPlayToken((t) => t + 1)
  }

  function attachVideo() {
    const id = parseYouTubeId(videoInput)
    if (!id || !song) return
    setVideoId(id)
    void saveVideoId(song.id, id)
  }

  /** 整段依序唸過一遍。這是「說」的版本，唱的版本在上面的原曲播放器 */
  async function playSpoken() {
    if (!song || !seg) return
    stopSpeaking()
    for (const l of seg.lines) {
      await speak(l.text, song.language).catch(() => undefined)
    }
  }

  async function harvest() {
    const me = profile
    if (!me || !song || !seg || harvestingRef.current || seg.chunks.length === 0) return
    harvestingRef.current = true
    const n = await harvestFromTask(
      me.id,
      song.language,
      seg.chunks.map((c) => ({ word: c.text, meaning_zh: c.zh, example: c.usage })),
    ).catch(() => 0)
    setHarvested(n)
    void logActivity(me.id).catch(() => undefined)
    harvestingRef.current = false
  }

  const start = range ? Math.max(0, Math.floor(range.start + offset)) : 0
  const end = range ? Math.ceil(range.end + offset) : 0

  return (
    <main className="mx-auto max-w-xl p-6 pb-16 lg:max-w-3xl">
      <header className="flex items-center justify-between pt-2">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{song.title}</h1>
          <p className="truncate text-sm text-slate-500">{song.artist}</p>
        </div>
        <Link
          to="/song"
          onClick={stopSpeaking}
          className="shrink-0 rounded-full px-4 py-2 text-sm text-slate-500 active:bg-slate-100"
        >
          返回
        </Link>
      </header>

      {lesson.summary && (
        <p className="mt-3 rounded-2xl bg-white p-4 text-sm leading-relaxed text-slate-600 shadow-sm ring-1 ring-slate-200/60">
          {lesson.summary}
        </p>
      )}

      <div className="mt-4 flex items-center justify-between">
        <h2 className="font-bold text-slate-800">{seg.label}</h2>
        <span className="text-xs text-slate-400">
          第 {safeIndex + 1} / {total} 段
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-teal-600 transition-all duration-300"
          style={{ width: `${((safeIndex + 1) / total) * 100}%` }}
        />
      </div>

      {/* 原曲：只播這一段。反覆聽同一句才是學歌真正有效的練法 */}
      <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/60">
        {videoId ? (
          <>
            {playToken > 0 && (
              <div className="mb-3 overflow-hidden rounded-xl bg-black">
                <iframe
                  key={playToken}
                  title="原曲"
                  className="aspect-video w-full"
                  src={
                    `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0` +
                    (range ? `&start=${start}&end=${end}` : '')
                  }
                  allow="autoplay; encrypted-media"
                  allowFullScreen
                />
              </div>
            )}
            <button
              onClick={() => setPlayToken((t) => t + 1)}
              className="w-full rounded-xl bg-rose-50 py-3 font-bold text-rose-700"
            >
              {range ? `▶︎ 播這一段（${start}s–${end}s）` : '▶︎ 播放原曲'}
            </button>
            {range ? (
              <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-slate-400">
                <span>影片有片頭、對不上？</span>
                <button
                  onClick={() => nudge(-1)}
                  className="rounded-lg bg-slate-100 px-2.5 font-bold text-slate-600"
                >
                  −1
                </button>
                <span className="tabular-nums text-slate-500">
                  {offset === 0 ? '未調整' : `已調 ${offset > 0 ? '+' : ''}${offset} 秒`}
                </span>
                <button
                  onClick={() => nudge(1)}
                  className="rounded-lg bg-slate-100 px-2.5 font-bold text-slate-600"
                >
                  ＋1
                </button>
              </div>
            ) : (
              <p className="mt-2 text-center text-xs text-slate-400">
                這首沒有逐句時間，只能整首播放
              </p>
            )}
          </>
        ) : (
          <>
            <p className="text-sm text-slate-500">貼上原曲連結就能一段一段循環播</p>
            <div className="mt-2 flex gap-2">
              <input
                value={videoInput}
                onChange={(e) => setVideoInput(e.target.value)}
                placeholder="https://youtu.be/…"
                className="min-w-0 flex-1 rounded-xl border border-slate-300 p-3 text-sm"
              />
              <button
                onClick={attachVideo}
                className="shrink-0 rounded-xl bg-teal-600 px-4 font-semibold text-white"
              >
                加入
              </button>
            </div>
          </>
        )}
      </section>

      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <ul>
          {seg.lines.map((l, i) => (
            <LineRow key={i} line={l} onPlay={() => void speak(l.text, song.language).catch(() => undefined)} />
          ))}
        </ul>
        <button
          onClick={() => void playSpoken()}
          className="mt-3 w-full rounded-xl bg-teal-50 py-3 font-semibold text-teal-700"
        >
          🔊 整段唸一次（說的版本）
        </button>
        <p className="mt-1.5 text-center text-xs text-slate-400">
          唱的練節奏與記憶，說的練正確的重音與語調
        </p>
      </section>

      {/* 唱 vs 說：跟著唱會把錯的節奏與音高一起練進去，而且定型之後很難改 */}
      {seg.prosody.length > 0 && (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="font-bold text-slate-800">唱起來跟說起來不一樣</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            旋律會把重音與音高帶走。這幾句照著唱沒問題，但講話時要改回來
          </p>
          <ul className="mt-3 space-y-3">
            {seg.prosody.map((p, i) => (
              <li key={i} className="rounded-xl bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-700">{p.line}</p>
                <p className="mt-1.5 text-sm">
                  <span className="mr-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-xs font-bold text-rose-700">唱</span>
                  <span className="text-slate-600">{p.sung}</span>
                </p>
                <p className="mt-1 text-sm">
                  <span className="mr-1.5 rounded bg-teal-100 px-1.5 py-0.5 text-xs font-bold text-teal-700">說</span>
                  <span className="font-semibold text-slate-800">{p.spoken}</span>
                </p>
                {p.note && <p className="mt-1 text-xs leading-relaxed text-slate-500">{p.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {seg.reductions.length > 0 && (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="font-bold text-slate-800">這段的連音與縮讀</h3>
          <p className="mt-0.5 text-xs text-slate-500">聽不懂母語者講話，多半不是單字不夠，是這些</p>
          <ul className="mt-3 space-y-2">
            {seg.reductions.map((r, i) => (
              <li key={i} className="text-sm">
                <span className="text-slate-500">{r.written}</span>
                <span className="mx-1.5 text-slate-300">→</span>
                <span className="font-bold text-slate-800">{r.sung}</span>
                {r.note && <span className="mt-0.5 block text-xs text-slate-500">{r.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {seg.chunks.length > 0 && (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="font-bold text-slate-800">可以帶走的語塊（{seg.chunks.length}）</h3>
          <p className="mt-0.5 text-xs text-slate-500">只從「可以直接拿去用」的句子裡挑</p>
          <ul className="mt-3 space-y-2.5">
            {seg.chunks.map((c, i) => (
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

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => go(safeIndex - 1)}
          disabled={safeIndex === 0}
          className="flex-1 rounded-xl bg-white py-3.5 font-bold text-slate-600 shadow-sm ring-1 ring-slate-200/60 disabled:opacity-40"
        >
          上一段
        </button>
        <button
          onClick={() => (last ? navigate('/song') : go(safeIndex + 1))}
          className="flex-1 rounded-xl bg-teal-600 py-3.5 font-bold text-white"
        >
          {last ? '學完了' : '下一段'}
        </button>
      </div>
    </main>
  )
}
