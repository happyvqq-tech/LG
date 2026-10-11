// 影片學習首頁：給主題 → AI 給搜尋方向 → 挑一支 → 貼逐字稿 → 生成教材
//
// ── 跟歌曲刻意走不同的路 ───────────────────────────────────
//
// 歌曲可以推薦具體曲目（「Let It Be 是 The Beatles 唱的」是模型記得住的常識），
// 但 YouTube 影片不行——模型記不住哪支存在。推薦一支不存在的影片比不推薦更糟，
// 使用者搜不到就不信任整個功能。所以這裡 AI 只給**搜尋方向**，
// 真實影片由 YouTube 搜尋補上；沒設 YOUTUBE_API_KEY 的話就給一個搜尋連結，
// 讓使用者自己挑——其實更好，他看得到縮圖與長度。
//
// 逐字稿也沒有 LRCLIB 那種免費來源（captions.download 只有影片擁有者能用），
// 一律從 YouTube 自己的「顯示轉錄稿」面板複製貼上。
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { createVideo, deleteVideo, listVideos, resolvePicks, suggestSearches } from '../lib/videoService'
import { parseYouTubeId } from '../lib/songService'
import { TRANSCRIPT_MIN_CHARS, type VideoPick } from '../lib/prompts/video'
import type { ResolvedPick } from '../lib/videoService'
import { ClaudeError } from '../lib/claude'
import ErrorNote from '../components/ErrorNote'
import { isTaskLanguage, type TaskLanguage, type Video } from '../lib/types'

/** 幾個起步用的主題，省掉「要填什麼」的猶豫 */
const TOPIC_HINTS = ['日常生活', '旅遊', '料理', '工作與職場', '科技', '健康運動']

/** 一個搜尋方向。搜到真實影片就直接開工，搜不到就給 YouTube 搜尋連結讓使用者自己挑 */
export function PickCard({ pick, onPick }: { pick: ResolvedPick; onPick: () => void }) {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(pick.query)}`

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <p className="font-bold">{pick.label}</p>
      <p className="mt-1 break-words text-xs text-slate-400">🔍 {pick.query}</p>
      {pick.minutes && <p className="mt-1 text-xs text-slate-400">建議片長 {pick.minutes}</p>}
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{pick.why}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-amber-700">⚠️ {pick.caution}</p>

      {pick.videoId ? (
        <>
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            搜到了：{pick.videoTitle || '（無標題）'}
          </p>
          <button onClick={onPick} className="mt-2 w-full rounded-xl bg-teal-50 py-3 font-bold text-teal-700">
            學這支
          </button>
          <a
            href={searchUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1.5 block py-2 text-center text-xs text-slate-400"
          >
            想自己挑別支 →
          </a>
        </>
      ) : (
        <>
          {/* 沒設 YOUTUBE_API_KEY 的部署走這條。自己挑其實更好：
              縮圖、長度、留言一眼就看得到，AI 看不到 */}
          <a
            href={searchUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 block w-full rounded-xl bg-rose-50 py-3 text-center font-bold text-rose-700"
          >
            用這個方向去 YouTube 搜 →
          </a>
          <button onClick={onPick} className="mt-2 w-full rounded-xl bg-teal-50 py-3 font-bold text-teal-700">
            挑好了，貼連結與逐字稿
          </button>
        </>
      )}
    </div>
  )
}

interface Draft {
  title: string
  videoId: string
  /** 從推薦卡進來時帶著，讓使用者知道自己在看哪一個方向 */
  pick: VideoPick | null
}

export default function VideoHome() {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const learnable = useMemo(() => (profile?.languages ?? []).filter(isTaskLanguage), [profile])
  const [language, setLanguage] = useState<TaskLanguage>(learnable[0] ?? '英文')
  const [videos, setVideos] = useState<Video[] | null>(null)
  /** 留原始錯誤物件：ClaudeError 的狀態碼與上游訊息都在裡面，轉字串就查不到問題 */
  const [errorMsg, setErrorMsg] = useState<unknown>('')

  const [topic, setTopic] = useState('')
  const [picks, setPicks] = useState<ResolvedPick[] | null>(null)
  const [suggesting, setSuggesting] = useState(false)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [linkInput, setLinkInput] = useState('')
  const [transcript, setTranscript] = useState('')
  const [building, setBuilding] = useState(false)

  useEffect(() => {
    if (!profile) return
    let alive = true
    setVideos(null)
    setErrorMsg('')
    listVideos(profile.id)
      .then((list) => alive && setVideos(list))
      .catch((e: unknown) => {
        if (!alive) return
        setVideos([])
        const msg = String((e as Error).message)
        setErrorMsg(
          msg.includes('videos')
            ? '還沒有 videos 資料表。到 Supabase 的 SQL Editor 跑一次 supabase/migration-015.sql 就可以了。'
            : `讀取影片失敗：${msg}`,
        )
      })
    return () => {
      alive = false
    }
  }, [profile])

  const mine = useMemo(() => (videos ?? []).filter((v) => v.language === language), [videos, language])
  const elsewhere = useMemo(() => (videos ?? []).length - mine.length, [videos, mine])

  async function recommend() {
    if (!profile || suggesting) return
    setSuggesting(true)
    setErrorMsg('')
    try {
      const list = await suggestSearches(
        language,
        profile.level,
        topic.trim() || '日常生活',
        profile.interests ?? null,
      )
      // 搜尋方向先出來，真實影片再補上去——搜不到不是錯誤
      setPicks(list.map((p) => ({ ...p, videoId: null, videoTitle: null })))
      const resolved = await resolvePicks(list).catch(() => null)
      if (resolved) setPicks(resolved)
    } catch (e: unknown) {
      setErrorMsg(e instanceof ClaudeError ? e : `找方向失敗：${String((e as Error).message)}`)
    } finally {
      setSuggesting(false)
    }
  }

  function openDraft(title: string, videoId: string, pick: VideoPick | null) {
    setDraft({ title, videoId, pick })
    setLinkInput('')
    setTranscript('')
    setErrorMsg('')
  }

  async function build() {
    if (!profile || !draft || building) return
    const id = draft.videoId || parseYouTubeId(linkInput)
    if (!id) {
      setErrorMsg('請貼上影片連結——播放要用它，少了就只剩文字稿')
      return
    }
    if (!draft.title.trim()) {
      setErrorMsg('給這支影片一個名字，之後在教材庫才找得到')
      return
    }
    if (transcript.trim().length < TRANSCRIPT_MIN_CHARS) {
      setErrorMsg('逐字稿看起來太短，是不是只複製到前面幾句？')
      return
    }
    setBuilding(true)
    setErrorMsg('')
    try {
      const video = await createVideo(
        profile.id,
        language,
        profile.level,
        draft.title,
        id,
        transcript,
      )
      setVideos((prev) => [video, ...(prev ?? [])])
      navigate(`/video/${video.id}`)
    } catch (e: unknown) {
      setErrorMsg(e instanceof ClaudeError ? e : `生成教材失敗：${String((e as Error).message)}`)
    } finally {
      setBuilding(false)
    }
  }

  async function remove(video: Video) {
    if (!profile) return
    await deleteVideo(video.id, profile.id).catch(() => undefined)
    setVideos((prev) => (prev ?? []).filter((v) => v.id !== video.id))
  }

  if (!profile) return null

  // ── 貼逐字稿的畫面 ────────────────────────────────────
  if (draft) {
    const id = draft.videoId || parseYouTubeId(linkInput)
    return (
      <main className="mx-auto max-w-xl p-6 pb-16 lg:max-w-3xl">
        <header className="flex items-center justify-between pt-2">
          <h1 className="min-w-0 truncate text-xl font-bold">{draft.title || '加一支影片'}</h1>
          <button
            onClick={() => {
              setDraft(null)
              setErrorMsg('')
            }}
            className="shrink-0 rounded-full px-4 py-2 text-sm text-slate-500 active:bg-slate-100"
          >
            返回
          </button>
        </header>

        {draft.pick && (
          <p className="mt-3 rounded-2xl bg-white p-4 text-sm leading-relaxed text-slate-600 shadow-sm ring-1 ring-slate-200/60">
            {draft.pick.label}
            <span className="mt-1 block text-xs text-amber-700">⚠️ {draft.pick.caution}</span>
          </p>
        )}

        <div className="mt-4">
          <label className="block text-sm font-semibold text-slate-600" htmlFor="video-title">
            影片名稱
          </label>
          <input
            id="video-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="例如：東京一日 vlog"
            className="mt-1 w-full rounded-xl border border-slate-300 p-3"
          />
        </div>

        {draft.videoId ? (
          <p className="mt-3 text-sm text-slate-500">🎬 已帶入影片，學習時可以只循環播那一段</p>
        ) : (
          <div className="mt-3">
            <label className="block text-sm font-semibold text-slate-600" htmlFor="video-link">
              YouTube 連結
            </label>
            <input
              id="video-link"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              placeholder="https://youtu.be/…"
              className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm"
            />
          </div>
        )}

        {/* 逐字稿為什麼要自己貼：YouTube 的字幕下載端點只有影片擁有者能呼叫 */}
        <div className="mt-4 rounded-2xl bg-teal-50 p-4 text-sm leading-relaxed text-teal-900 ring-1 ring-teal-200/70">
          <span className="font-semibold">怎麼拿逐字稿</span>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-xs text-teal-900/85">
            <li>在 YouTube 打開那支影片，點簡介下方的「顯示轉錄稿」</li>
            <li>右邊會出現逐字稿，整段選取複製</li>
            <li>貼到下面即可。時間戳留著更好——那樣才能只循環播教材那一段</li>
          </ol>
          <span className="mt-2 block text-xs text-teal-800/75">
            沒有「顯示轉錄稿」代表這支沒有字幕，換一支吧。
            自動辨識的稿子有錯字是正常的，教材會照原文處理、不會幫它亂改。
          </span>
        </div>

        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          rows={12}
          placeholder={'0:00\nhello and welcome back\n0:03\ntoday we\'re going to…'}
          className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-sm leading-relaxed"
        />
        <p className="mt-1 text-xs text-slate-400">
          貼長一點沒關係，教材只會從裡面挑最值得精聽的 8-15 行，不會整支攤開來。
        </p>

        {id && (
          <div className="mt-3 overflow-hidden rounded-xl bg-black">
            <iframe
              title="預覽"
              className="aspect-video w-full"
              src={`https://www.youtube-nocookie.com/embed/${id}?playsinline=1&rel=0`}
              allow="encrypted-media"
              allowFullScreen
            />
          </div>
        )}

        {errorMsg ? <ErrorNote error={errorMsg} className="mt-3" /> : null}

        <button
          onClick={() => void build()}
          disabled={building}
          className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
        >
          {building ? '分析中，約需 20 秒…' : '做成教材'}
        </button>
      </main>
    )
  }

  // ── 影片首頁 ──────────────────────────────────────────
  return (
    <main className="mx-auto max-w-xl p-6 pb-16 lg:max-w-3xl">
      <header className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-2xl font-bold">影片</h1>
          <p className="mt-1 text-sm text-slate-500">用真實口語練耳朵・專治「每個字都懂卻聽不懂」</p>
        </div>
        <Link to="/home" className="shrink-0 rounded-full px-4 py-2 text-sm text-slate-500 active:bg-slate-100">
          返回
        </Link>
      </header>

      {learnable.length > 1 && (
        <div className="mt-5 flex gap-2">
          {learnable.map((l) => (
            <button
              key={l}
              onClick={() => {
                setLanguage(l)
                setPicks(null)
              }}
              className={`rounded-full px-5 py-2 text-sm font-semibold ${
                language === l ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 shadow-sm'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      {errorMsg ? <ErrorNote error={errorMsg} className="mt-4" /> : null}

      {videos && mine.length > 0 && (
        <section className="mt-5">
          <h2 className="px-1 font-bold text-slate-800">我的影片（{mine.length}）</h2>
          <p className="mt-0.5 px-1 text-xs text-slate-500">做過的教材都留著，可以反覆回來精聽</p>
          <div className="mt-2 grid gap-3">
            {mine.map((v) => (
              <div key={v.id} className="relative">
                <Link
                  to={`/video/${v.id}`}
                  className="block rounded-2xl bg-white p-5 pr-16 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
                >
                  <span className="block font-bold">{v.title}</span>
                  <span className="block text-sm text-slate-500">
                    {new Date(v.created_at).toLocaleDateString('zh-TW')}
                  </span>
                </Link>
                <button
                  onClick={() => void remove(v)}
                  aria-label={`刪除 ${v.title}`}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-3 text-sm text-slate-300 active:bg-slate-100"
                >
                  刪除
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 同時學兩種語言的人最容易踩的坑：剛做好的教材換個語言就看不到，以為不見了 */}
      {videos !== null && elsewhere > 0 && (
        <p className="mt-3 px-1 text-xs text-slate-500">
          其他語言還有 {elsewhere} 支，切換上面的語言就看得到。
        </p>
      )}

      <section className="mt-6">
        <label className="block px-1 text-sm font-semibold text-slate-600" htmlFor="video-topic">
          想看什麼主題？
        </label>
        <input
          id="video-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="例如：咖啡、露營、面試"
          className="mt-1 w-full rounded-xl border border-slate-300 p-3"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {TOPIC_HINTS.map((t) => (
            <button
              key={t}
              onClick={() => setTopic(t)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                topic === t ? 'bg-teal-600 text-white' : 'bg-white text-slate-600 shadow-sm ring-1 ring-slate-200/60'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <button
          onClick={() => void recommend()}
          disabled={suggesting}
          className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
        >
          {suggesting ? '規劃中，約需 15 秒…' : picks ? '換一批方向' : '找適合我的影片 🎬'}
        </button>

        {picks && (
          <>
            <p className="mt-4 px-1 text-xs leading-relaxed text-slate-500">
              AI 不推薦具體影片——它記不住哪支存在，推薦不存在的影片比不推薦更糟。
              所以這裡給的是調校過的「搜尋方向」，影片由 YouTube 搜尋補上。
            </p>
            <div className="mt-3 grid gap-3">
              {picks.map((p) => (
                <PickCard
                  key={p.query}
                  pick={p}
                  onPick={() => openDraft(p.videoTitle || p.label, p.videoId ?? '', p)}
                />
              ))}
            </div>
          </>
        )}

        <button
          onClick={() => openDraft('', '', null)}
          className="mt-3 w-full rounded-xl bg-white py-3 font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200/60"
        >
          我自己有想看的影片
        </button>
      </section>
    </main>
  )
}
