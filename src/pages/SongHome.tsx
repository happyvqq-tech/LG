// 歌曲學習首頁：推薦歌單 → 貼歌詞 → 生成教材
//
// 為什麼歌曲值得獨立一條通道：它在三件事上無可取代——
//   1. 耳蟲效應＝免費的重複。一個詞要 10-20 次遭遇才習得，一首喜歡的歌
//      一週就給你 50 次，而且完全不費力
//   2. 連音與縮讀（gonna／〜てる）——聽力理解的第一殺手，課本幾乎不教
//   3. 節奏：英文重音計時、日文拍計時，跟著唱會強迫產出正確節奏
//
// 但歌詞拿來學文法是災難（為押韻刪助詞、倒裝、用文語），所以教材裡
// 每一行都會標「能不能拿去用」，見 SongStudy。
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { createSong, deleteSong, listSongs, suggestSongs } from '../lib/songService'
import { LYRICS_MIN_CHARS, type SongSuggestion } from '../lib/prompts/song'
import { ClaudeError } from '../lib/claude'
import { isTaskLanguage, type Song, type TaskLanguage } from '../lib/types'

/** 1-5 分畫成五個點，比數字好掃 */
function Score({ label, value }: { label: string; value: number }) {
  const n = Math.max(0, Math.min(5, Math.round(value)))
  return (
    <span className="flex items-center gap-1 text-xs text-slate-500">
      {label}
      <span className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full ${i <= n ? 'bg-teal-600' : 'bg-slate-200'}`}
          />
        ))}
      </span>
    </span>
  )
}

export default function SongHome() {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const learnable = useMemo(
    () => (profile?.languages ?? []).filter(isTaskLanguage),
    [profile],
  )
  const [language, setLanguage] = useState<TaskLanguage>(learnable[0] ?? '英文')
  const [songs, setSongs] = useState<Song[] | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const [suggestions, setSuggestions] = useState<SongSuggestion[] | null>(null)
  const [suggesting, setSuggesting] = useState(false)

  /** 正在貼歌詞的那一首（可能來自推薦，也可能是自己輸入的） */
  const [draft, setDraft] = useState<{ title: string; artist: string } | null>(null)
  const [lyrics, setLyrics] = useState('')
  const [building, setBuilding] = useState(false)

  useEffect(() => {
    if (!profile) return
    let alive = true
    setSongs(null)
    setErrorMsg('')
    listSongs(profile.id, language)
      .then((list) => {
        if (alive) setSongs(list)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setSongs([])
        const msg = String((e as Error).message)
        // 表還沒建就是還沒跑 migration-013，這個訊息要說得夠具體才修得動
        setErrorMsg(
          msg.includes('songs')
            ? '還沒有 songs 資料表。到 Supabase 的 SQL Editor 跑一次 supabase/migration-013.sql 就可以了。'
            : `讀取歌單失敗：${msg}`,
        )
      })
    return () => {
      alive = false
    }
  }, [profile, language])

  async function recommend() {
    if (!profile || suggesting) return
    setSuggesting(true)
    setErrorMsg('')
    try {
      const list = await suggestSongs(
        language,
        profile.level,
        profile.interests ?? null,
        (songs ?? []).map((s) => s.title),
      )
      setSuggestions(list)
    } catch (e: unknown) {
      setErrorMsg(e instanceof ClaudeError ? e.friendlyMessage : `推薦失敗：${String((e as Error).message)}`)
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
      setErrorMsg('歌詞看起來太短，是不是只複製到一部分？')
      return
    }
    setBuilding(true)
    setErrorMsg('')
    try {
      const song = await createSong(
        profile.id,
        language,
        profile.level,
        draft.title,
        draft.artist,
        lyrics,
      )
      navigate(`/song/${song.id}`)
    } catch (e: unknown) {
      setErrorMsg(e instanceof ClaudeError ? e.friendlyMessage : `生成教材失敗：${String((e as Error).message)}`)
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

  // ── 貼歌詞的畫面 ──────────────────────────────────────
  if (draft) {
    return (
      <main className="mx-auto max-w-xl p-6 pb-16 lg:max-w-3xl">
        <header className="flex items-center justify-between pt-2">
          <h1 className="text-xl font-bold">{draft.title ? draft.title : '加一首歌'}</h1>
          <button
            onClick={() => {
              setDraft(null)
              setLyrics('')
              setErrorMsg('')
            }}
            className="shrink-0 rounded-full px-4 py-2 text-sm text-slate-500 active:bg-slate-100"
          >
            返回
          </button>
        </header>

        {/* 從推薦進來時已經填好了，但仍開放修改——推薦的歌名偶爾會差一個副標 */}
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

        <div className="mt-4 rounded-2xl bg-sky-50 p-4 text-sm leading-relaxed text-sky-900 ring-1 ring-sky-200/70">
          把歌詞從你聽歌的地方複製過來貼在下面。
          <span className="mt-1 block text-xs text-sky-800/80">
            為什麼要你貼而不是我直接生成：AI 是憑記憶背歌詞的，再紅的歌也會有錯字或漏行。
            跟著原曲唱卻對不上，你會分不出是自己聽錯還是教材錯——所以歌詞一律以你貼的為準，
            我只負責分析與教學。
          </span>
        </div>

        <textarea
          value={lyrics}
          onChange={(e) => setLyrics(e.target.value)}
          rows={12}
          placeholder={'在這裡貼上歌詞…\n\n一行一句，有 [Verse 1] 這種標記也沒關係，會自動忽略'}
          className="mt-4 w-full rounded-xl border border-slate-300 p-3 text-sm leading-relaxed"
        />

        {errorMsg && <p className="mt-3 rounded-xl bg-red-50 p-3 text-red-600">{errorMsg}</p>}

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

  // ── 歌單首頁 ──────────────────────────────────────────
  return (
    <main className="mx-auto max-w-xl p-6 pb-16 lg:max-w-3xl">
      <header className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-2xl font-bold">歌曲</h1>
          <p className="mt-1 text-sm text-slate-500">
            跟著唱學節奏與連音・每句都會標「能不能拿去用」
          </p>
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

      {errorMsg && <p className="mt-4 rounded-xl bg-red-50 p-4 text-red-600">{errorMsg}</p>}

      {/* 我的歌單 */}
      {songs && songs.length > 0 && (
        <section className="mt-5 grid gap-3">
          {songs.map((s) => (
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
        </section>
      )}

      {songs !== null && songs.length === 0 && !errorMsg && (
        <p className="mt-6 text-center text-sm text-slate-400">歌單還是空的，先讓我推薦幾首</p>
      )}

      {/* 推薦 */}
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
                <div key={`${s.title}-${s.artist}`} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
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
                    onClick={() => {
                      setDraft({ title: s.title, artist: s.artist })
                      setLyrics('')
                      setErrorMsg('')
                    }}
                    className="mt-3 w-full rounded-xl bg-teal-50 py-3 font-bold text-teal-700"
                  >
                    學這首
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* 自己有想學的歌就不必等推薦 */}
        <button
          onClick={() => {
            setDraft({ title: '', artist: '' })
            setLyrics('')
            setErrorMsg('')
          }}
          className="mt-3 w-full rounded-xl bg-white py-3 font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200/60"
        >
          我自己有想學的歌
        </button>
      </section>
    </main>
  )
}
