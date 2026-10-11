// 歌曲分段學習
//
// 一次只學一段（副歌或一段主歌），不是整首四分鐘攤開來——那是歌詞本不是課。
//
// 畫面的重點不是翻譯，是每一行左邊那個標記：
//   ✅ 可以直接拿去用
//   ⚠️ 歌詞限定 → 展開看「平常會怎麼講」
// 歌詞為了押韻與音節數會刪助詞、倒裝、用文語，照著歌詞講話會很怪。
// 市面上的歌曲學習 App 多半只給「歌詞＋翻譯」，學習者唱得很開心，
// 然後把歌詞當成這個語言本來的樣子學走——這一頁就是為了擋那件事。
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { getSong, readLesson, saveSegmentIndex } from '../lib/songService'
import { harvestFromTask } from '../lib/vocabService'
import { logActivity } from '../lib/streakService'
import { speak, stopSpeaking } from '../lib/speech'
import type { SongLesson, SongLine } from '../lib/prompts/song'
import type { Song } from '../lib/types'

function LineRow({ line, onPlay }: { line: SongLine; onPlay: () => void }) {
  const [open, setOpen] = useState(false)

  return (
    <li className="border-t border-slate-100 py-3 first:border-t-0">
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
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-1 text-xs font-semibold text-amber-700"
            >
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
        }
      })
      .catch(() => alive && setSong(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [profile, songId])

  // 離開頁面時把還在唸的聲音停掉，不要跟著使用者跑到下一頁
  useEffect(() => stopSpeaking, [])

  if (!profile) return null
  if (loading) return <p className="p-10 text-center text-slate-400">載入中…</p>

  if (!song || !lesson) {
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
  const seg = lesson.segments[safeIndex]
  const last = safeIndex >= total - 1

  function go(next: number) {
    stopSpeaking()
    const clamped = Math.min(Math.max(next, 0), total - 1)
    setIndex(clamped)
    if (song) void saveSegmentIndex(song.id, clamped)
  }

  /** 整段依序唸過一遍。這是「說」的版本，唱的版本請去原曲聽 */
  async function playSegment() {
    if (!song) return
    stopSpeaking()
    for (const l of seg.lines) {
      await speak(l.text, song.language).catch(() => undefined)
    }
  }

  /** 語塊入單字庫，之後由間隔重複接手（跟任務完成時同一條路徑） */
  async function harvest() {
    // profile 在上面已經擋掉 null，但閉包裡 TypeScript 看不到那個縮窄，所以再取一次
    const me = profile
    if (!me || !song || harvestingRef.current || seg.chunks.length === 0) return
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

      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <ul>
          {seg.lines.map((l, i) => (
            <li key={i} className="list-none">
              <LineRow line={l} onPlay={() => void speak(l.text, song.language).catch(() => undefined)} />
            </li>
          ))}
        </ul>
        <button
          onClick={() => void playSegment()}
          className="mt-3 w-full rounded-xl bg-teal-50 py-3 font-semibold text-teal-700"
        >
          🔊 整段唸一次（說的版本）
        </button>
        <p className="mt-1.5 text-center text-xs text-slate-400">
          唱的版本請去原曲聽——唱的練節奏，說的練聽懂字詞
        </p>
      </section>

      {/* 連音與縮讀：課本幾乎不教，而這是聽力理解的第一殺手 */}
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
