// 歌曲學習首頁：推薦歌單 → 自動抓歌詞 → 生成教材
//
// 為什麼歌曲值得獨立一條通道：它在三件事上無可取代——
//   1. 耳蟲效應＝免費的重複。一個詞要 10-20 次遭遇才習得，一首喜歡的歌
//      一週就給你 50 次，而且完全不費力
//   2. 連音與縮讀（gonna／〜てる）——聽力理解的第一殺手，課本幾乎不教
//   3. 節奏：英文重音計時、日文拍計時，跟著唱會強迫產出正確節奏
//
// 歌詞由 LRCLIB 自動帶回來，但一定要讓使用者看過才生成——
// 社群資料庫有時會對到別的版本（Live、Remix、翻唱），而歌詞是整份教材的
// 唯一事實來源，錯了後面全錯。查不到時退回手動貼。
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import {
  createSong,
  deleteSong,
  fetchLyrics,
  findVideo,
  listAllSongs,
  parseYouTubeId,
  suggestSongs,
} from '../lib/songService'
import { LYRICS_MIN_CHARS, type SongSuggestion } from '../lib/prompts/song'
import { ClaudeError } from '../lib/claude'
import ErrorNote from '../components/ErrorNote'
import { isTaskLanguage, type Song, type TaskLanguage } from '../lib/types'

/** 1-5 分畫成五個點，比數字好掃 */
function Score({ label, value }: { label: string; value: number }) {
  const n = Math.max(0, Math.min(5, Math.round(value)))
  return (
    <span className="flex items-center gap-1 text-xs text-slate-500">
      {label}
      <span className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`h-1.5 w-1.5 rounded-full ${i <= n ? 'bg-teal-600' : 'bg-slate-200'}`} />
        ))}
      </span>
    </span>
  )
}

interface Draft {
  title: string
  artist: string
}

export default function SongHome() {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const learnable = useMemo(() => (profile?.languages ?? []).filter(isTaskLanguage), [profile])
  const [language, setLanguage] = useState<TaskLanguage>(learnable[0] ?? '英文')
  const [songs, setSongs] = useState<Song[] | null>(null)
  /** 存原始錯誤物件而不是字串：ClaudeError 的狀態碼與上游訊息在 message 裡，
   *  轉成字串就只剩那句籠統的白話，之後要查問題無從查起 */
  const [errorMsg, setErrorMsg] = useState<unknown>('')

  const [suggestions, setSuggestions] = useState<SongSuggestion[] | null>(null)
  const [suggesting, setSuggesting] = useState(false)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [lyrics, setLyrics] = useState('')
  const [synced, setSynced] = useState('')
  const [videoId, setVideoId] = useState('')
  const [videoInput, setVideoInput] = useState('')
  /** 自動抓的結果：找到 / 找不到 / 還在找 */
  const [autoState, setAutoState] = useState<'idle' | 'loading' | 'found' | 'missing'>('idle')
  const [building, setBuilding] = useState(false)

  useEffect(() => {
    if (!profile) return
    let alive = true
    setSongs(null)
    setErrorMsg('')
    listAllSongs(profile.id)
      .then((list) => alive && setSongs(list))
      .catch((e: unknown) => {
        if (!alive) return
        setSongs([])
        const msg = String((e as Error).message)
        setErrorMsg(
          msg.includes('songs')
            ? '還沒有 songs 資料表。到 Supabase 的 SQL Editor 跑一次 supabase/migration-013.sql 就可以了。'
            : `讀取歌單失敗：${msg}`,
        )
      })
    return () => {
      alive = false
    }
  }, [profile])

  /** 目前語言的歌，以及其他語言各有幾首（避免「教材不見了」的錯覺） */
  const mine = useMemo(() => (songs ?? []).filter((s) => s.language === language), [songs, language])
  const elsewhere = useMemo(() => (songs ?? []).length - mine.length, [songs, mine])

  /** 選了一首之後：同時去抓歌詞與原曲影片，兩邊都允許失敗 */
  async function openDraft(title: string, artist: string) {
    setDraft({ title, artist })
    setLyrics('')
    setSynced('')
    setVideoId('')
    setVideoInput('')
    setErrorMsg('')
    if (!title || !artist) {
      setAutoState('idle')
      return
    }
    setAutoState('loading')
    const [found, vid] = await Promise.all([fetchLyrics(title, artist), findVideo(title, artist)])
    if (found) {
      setLyrics(found.plain || found.synced.replace(/\[[\d:.]+\]/g, '').trim())
      setSynced(found.synced || '')
      setAutoState('found')
    } else {
      setAutoState('missing')
    }
    if (vid) setVideoId(vid)
  }

  async function recommend() {
    if (!profile || suggesting) return
    setSuggesting(true)
    setErrorMsg('')
    try {
      const list = await suggestSongs(
        language,
        profile.level,
        profile.interests ?? null,
        mine.map((s) => s.title),
      )
      setSuggestions(list)
    } catch (e: unknown) {
      setErrorMsg(e instanceof ClaudeError ? e : `推薦失敗：${String((e as Error).message)}`)
    } finally {
      setSuggesting(false)
    }
  }

  async function build() {
    if (!profile || !draft || building) return
    if (!draft.title.trim() || !draft.artist.trim()) {
      setErrorMsg('歌名與演唱者都要填——教材會用它們來判斷曲風與年代')
      return
    }
    if (lyrics.trim().length < LYRICS_MIN_CHARS) {
      setErrorMsg('歌詞看起來太短，是不是只抓到一部分？可以直接在上面補齊')
      return
    }
    setBuilding(true)
    setErrorMsg('')
    try {
      const manual = videoInput ? parseYouTubeId(videoInput) : null
      const song = await createSong(
        profile.id,
        language,
        profile.level,
        draft.title,
        draft.artist,
        lyrics,
        synced,
        manual ?? videoId,
      )
      setSongs((prev) => [song, ...(prev ?? [])])
      navigate(`/song/${song.id}`)
    } catch (e: unknown) {
      setErrorMsg(e instanceof ClaudeError ? e : `生成教材失敗：${String((e as Error).message)}`)
    } finally {
      setBuilding(false)
    }
  }

  async function remove(song: Song) {
    if (!profile) return
    await deleteSong(song.id, profile.id).catch(() => undefined)
    setSongs((prev) => (prev ?? []).filter((s) => s.id !== song.id))
  }

  if (!profile) return null

  // ── 確認歌詞的畫面 ────────────────────────────────────
  if (draft) {
    return (
      <main className="mx-auto max-w-xl p-6 pb-16 lg:max-w-3xl">
        <header className="flex items-center justify-between pt-2">
          <h1 className="text-xl font-bold">{draft.title || '加一首歌'}</h1>
          <button
            onClick={() => {
              setDraft(null)
              setAutoState('idle')
              setErrorMsg('')
            }}
            className="shrink-0 rounded-full px-4 py-2 text-sm text-slate-500 active:bg-slate-100"
          >
            返回
          </button>
        </header>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-semibold text-slate-600" htmlFor="song-title">
              歌名
            </label>
            <input
              id="song-title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="例如：Let It Be"
              className="mt-1 w-full rounded-xl border border-slate-300 p-3"
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-600" htmlFor="song-artist">
              演唱者
            </label>
            <input
              id="song-artist"
              value={draft.artist}
              onChange={(e) => setDraft({ ...draft, artist: e.target.value })}
              placeholder="例如：The Beatles"
              className="mt-1 w-full rounded-xl border border-slate-300 p-3"
            />
          </div>
        </div>

        {autoState === 'idle' && draft.title && draft.artist && (
          <button
            onClick={() => void openDraft(draft.title, draft.artist)}
            className="mt-3 w-full rounded-xl bg-white py-3 font-semibold text-teal-700 shadow-sm ring-1 ring-slate-200/60"
          >
            自動找歌詞
          </button>
        )}

        {autoState === 'loading' && (
          <p className="mt-4 rounded-xl bg-slate-100 p-4 text-center text-sm text-slate-500">
            正在找歌詞與原曲…
          </p>
        )}

        {autoState === 'found' && (
          <div className="mt-4 rounded-xl bg-teal-50 p-4 text-sm leading-relaxed text-teal-900 ring-1 ring-teal-200/70">
            已自動帶入歌詞{synced && '（含逐句時間，可以只循環播一段）'}。
            <span className="mt-1 block text-xs text-teal-800/80">
              請快速掃一眼對不對——歌詞庫偶爾會對到 Live 版或翻唱版。
              歌詞是整份教材的唯一依據，錯了後面全錯，有問題直接在下面改。
            </span>
          </div>
        )}

        {autoState === 'missing' && (
          <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200/70">
            查不到這首的歌詞，請自己從聽歌的地方複製貼上。
            <span className="mt-1 block text-xs text-amber-800/80">
              歌詞庫是社群維護的，冷門歌或太新的歌常常還沒收錄。
            </span>
          </div>
        )}

        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          rows={12}
          placeholder={'歌詞會自動帶入，沒抓到的話貼在這裡…'}
          className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-sm leading-relaxed"
        />

        {/* 原曲：自動找到就不必管，找不到才需要貼一次 */}
        {videoId ? (
          <p className="mt-3 text-sm text-slate-500">🎬 已找到原曲影片，學習時可以分段循環播放</p>
        ) : (
          <div className="mt-3">
            <label className="block text-sm font-semibold text-slate-600" htmlFor="song-video">
              原曲 YouTube 連結（選填）
            </label>
            <input
              id="song-video"
              value={videoInput}
              onChange={(e) => setVideoInput(e.target.value)}
              placeholder="https://youtu.be/…"
              className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm"
            />
            <p className="mt-1 text-xs text-slate-400">
              貼了才能一段一段循環播原曲。不貼也可以學，只是只有朗讀版的聲音。
            </p>
          </div>
        )}

        {errorMsg ? <ErrorNote error={errorMsg} className="mt-3" /> : null}

        <button
          onClick={() => void build()}
          disabled={building || autoState === 'loading'}
          className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
        >
          {building ? '分析中，約需 20 秒…' : '做成教材'}
        </button>
      </main>
    )
  }

  // ── 歌單首頁 ──────────────────────────────────────────
  return (
    <main className="mx-auto max-w-xl p-6 pb-16 lg:max-w-3xl">
      <header className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-2xl font-bold">歌曲</h1>
          <p className="mt-1 text-sm text-slate-500">跟著唱學節奏與連音・每句都會標「能不能拿去用」</p>
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
                setSuggestions(null)
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

      {songs && mine.length > 0 && (
        <section className="mt-5">
          <h2 className="px-1 font-bold text-slate-800">我的歌單（{mine.length}）</h2>
          <p className="mt-0.5 px-1 text-xs text-slate-500">
            做過的教材都留著，點進去可以接著上次的段落繼續練
          </p>
          <div className="mt-2 grid gap-3">
          {mine.map((s) => (
            <div key={s.id} className="relative">
              <Link
                to={`/song/${s.id}`}
                className="block rounded-2xl bg-white p-5 pr-16 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
              >
                <span className="block font-bold">{s.title}</span>
                <span className="block text-sm text-slate-500">{s.artist}</span>
              </Link>
              <button
                onClick={() => void remove(s)}
                aria-label={`刪除 ${s.title}`}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full px-3 text-sm text-slate-300 active:bg-slate-100"
              >
                刪除
              </button>
            </div>
          ))}
          </div>
        </section>
      )}

      {/* 同時學兩種語言的人最容易踩的坑：剛做好的教材換個語言就看不到，
          以為不見了。明講還有幾首在別的語言底下 */}
      {songs !== null && elsewhere > 0 && (
        <p className="mt-3 px-1 text-xs text-slate-500">
          其他語言還有 {elsewhere} 首，切換上面的語言就看得到。
        </p>
      )}

      {songs !== null && mine.length === 0 && elsewhere === 0 && !errorMsg && (
        <p className="mt-6 text-center text-sm text-slate-400">歌單還是空的，先讓我推薦幾首</p>
      )}

      <section className="mt-6">
        <button
          onClick={() => void recommend()}
          disabled={suggesting}
          className="w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
        >
          {suggesting ? '挑歌中，約需 15 秒…' : suggestions ? '換一批推薦' : '推薦適合我的歌 🎵'}
        </button>

        {suggestions && (
          <>
            <p className="mt-4 px-1 text-xs leading-relaxed text-slate-500">
              紅不等於好學：排行榜前十裡適合 {profile.level} 的通常只有兩三首。
              所以「知名度」跟「好學度」分開給分，每首也都寫了難在哪。
            </p>
            <div className="mt-3 grid gap-3">
              {suggestions.map((s) => (
                <div
                  key={`${s.title}-${s.artist}`}
                  className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60"
                >
                  <p className="font-bold">{s.title}</p>
                  <p className="text-sm text-slate-500">
                    {s.artist}
                    {s.year ? `・${s.year}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    <Score label="知名度" value={s.fame} />
                    <Score label="好學度" value={s.learnability} />
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.why}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-amber-700">⚠️ {s.caution}</p>
                  <button
                    onClick={() => void openDraft(s.title, s.artist)}
                    className="mt-3 w-full rounded-xl bg-teal-50 py-3 font-bold text-teal-700"
                  >
                    學這首
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <button
          onClick={() => void openDraft('', '')}
          className="mt-3 w-full rounded-xl bg-white py-3 font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200/60"
        >
          我自己有想學的歌
        </button>
      </section>
    </main>
  )
}
