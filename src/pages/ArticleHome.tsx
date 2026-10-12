// 文章學習首頁：貼網址或貼全文 → AI 分析 → 做成教材
//
// ── 為什麼這裡沒有「AI 推薦文章」 ──────────────────────────
//
// 跟影片同一個理由：模型記不住哪篇文章存在、標題叫什麼、在哪個網站。
// 推薦一篇不存在的文章比不推薦更糟。真實素材只能來自真實來源——
// 使用者貼網址（Worker 抓一次），或直接貼全文。
//
// ── 為什麼真實文章值得一條獨立通道 ────────────────────────
//
// 每日任務的聽力稿是為你量身生成的（這週的文法點、你的舊錯、你的興趣），
// 那是它的價值，但也意味著它永遠是「為教學而寫」的文本。
// 真實文章相反：它是人寫給人看的，連貫性是先天的，而且會出現教材
// 不會出現的東西——三層子句、定指回指、書面語詞彙。
// 那些正是 B1 讀不動長文的真正原因，而不是生字。
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import {
  ARTICLE_MISS_NOTE,
  createArticle,
  deleteArticle,
  fetchArticle,
  listArticles,
  type ArticleMiss,
} from '../lib/articleService'
import { ARTICLE_MAX_CHARS, ARTICLE_MIN_CHARS } from '../lib/prompts/article'
import { ClaudeError } from '../lib/claude'
import ErrorNote from '../components/ErrorNote'
import { isTaskLanguage, type Article, type TaskLanguage } from '../lib/types'

/**
 * 找素材的起點。刻意只列「能合法自由使用」與「好找」的來源，
 * 而且標出各自的坑——沒有缺點的素材不存在。
 */
const SOURCE_HINTS: Record<TaskLanguage, Array<{ name: string; note: string }>> = {
  英文: [
    { name: 'BBC News / The Guardian', note: '硬新聞，句子長、名詞化密集，B2 以上比較吃得下' },
    { name: 'Wikinews（CC 授權，可自由使用）', note: '寫得比商業媒體平，但更新量不大' },
    { name: 'Aeon / Nautilus 的長文', note: '論述清楚、連接詞用得漂亮，適合練讀邏輯骨架' },
  ],
  日文: [
    { name: 'NHK NEWS WEB', note: '標準的硬新聞文體，漢語サ変動詞與「〜とみられる」很密' },
    { name: 'NHK NEWS WEB EASY', note: '刻意簡化過，讀起來輕鬆但學不到真實書面語' },
    { name: 'note / 個人ブログ的長文', note: '比新聞口語，但品質落差大，挑寫得好的' },
  ],
  韓文: [
    { name: '한겨레 / 경향신문', note: '한자어 명사化很重，長修飾節是主要難點' },
    { name: 'BBC News 코리아', note: '句子比韓國本地報紙短，入門比較好進' },
    { name: '브런치(brunch) 的隨筆', note: '口語一點，適合練書面轉口語' },
  ],
}

interface Draft {
  title: string
  text: string
  sourceUrl: string
}

export default function ArticleHome() {
  const navigate = useNavigate()
  const { profile } = useProfile()
  const learnable = useMemo(() => (profile?.languages ?? []).filter(isTaskLanguage), [profile])
  const [language, setLanguage] = useState<TaskLanguage>(learnable[0] ?? '英文')
  const [articles, setArticles] = useState<Article[] | null>(null)
  /** 留原始錯誤物件：ClaudeError 的狀態碼與上游訊息都在裡面，轉字串就查不到問題 */
  const [errorMsg, setErrorMsg] = useState<unknown>('')

  const [urlInput, setUrlInput] = useState('')
  const [fetching, setFetching] = useState(false)
  const [miss, setMiss] = useState<ArticleMiss | null>(null)

  const [draft, setDraft] = useState<Draft | null>(null)
  const [building, setBuilding] = useState(false)

  useEffect(() => {
    if (!profile) return
    let alive = true
    setArticles(null)
    setErrorMsg('')
    listArticles(profile.id)
      .then((list) => alive && setArticles(list))
      .catch((e: unknown) => {
        if (!alive) return
        setArticles([])
        const msg = String((e as Error).message)
        setErrorMsg(
          msg.includes('articles')
            ? '還沒有 articles 資料表。到 Supabase 的 SQL Editor 跑一次 supabase/migration-016.sql 就可以了。'
            : `讀取文章失敗：${msg}`,
        )
      })
    return () => {
      alive = false
    }
  }, [profile])

  const mine = useMemo(() => (articles ?? []).filter((a) => a.language === language), [articles, language])
  const elsewhere = useMemo(() => (articles ?? []).length - mine.length, [articles, mine])

  async function grab() {
    if (fetching || !urlInput.trim()) return
    setFetching(true)
    setMiss(null)
    setErrorMsg('')
    const result = await fetchArticle(urlInput.trim())
    if ('text' in result) {
      setDraft({ title: result.title, text: result.text, sourceUrl: urlInput.trim() })
    } else {
      setMiss(result.miss)
    }
    setFetching(false)
  }

  async function build() {
    if (!profile || !draft || building) return
    if (!draft.title.trim()) {
      setErrorMsg('給這篇一個標題，之後在教材庫才找得到')
      return
    }
    if (draft.text.trim().length < ARTICLE_MIN_CHARS) {
      setErrorMsg('內文看起來太短，是不是只貼到導言？')
      return
    }
    setBuilding(true)
    setErrorMsg('')
    try {
      const article = await createArticle(
        profile.id,
        language,
        profile.level,
        draft.title,
        draft.text,
        draft.sourceUrl,
      )
      setArticles((prev) => [article, ...(prev ?? [])])
      navigate(`/article/${article.id}`)
    } catch (e: unknown) {
      setErrorMsg(e instanceof ClaudeError ? e : `生成教材失敗：${String((e as Error).message)}`)
    } finally {
      setBuilding(false)
    }
  }

  async function remove(article: Article) {
    if (!profile) return
    await deleteArticle(article.id, profile.id).catch(() => undefined)
    setArticles((prev) => (prev ?? []).filter((a) => a.id !== article.id))
  }

  if (!profile) return null

  // ── 確認原文的畫面 ────────────────────────────────────
  if (draft) {
    const over = draft.text.length > ARTICLE_MAX_CHARS
    return (
      <main className="mx-auto max-w-xl p-6 pb-16 lg:max-w-3xl">
        <header className="flex items-center justify-between pt-2">
          <h1 className="min-w-0 truncate text-xl font-bold">{draft.title || '加一篇文章'}</h1>
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

        <div className="mt-4">
          <label className="block text-sm font-semibold text-slate-600" htmlFor="article-title">
            標題
          </label>
          <input
            id="article-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="例如：遠端工作的下一步"
            className="mt-1 w-full rounded-xl border border-slate-300 p-3"
          />
        </div>

        {draft.sourceUrl && (
          <p className="mt-2 break-all text-xs text-slate-400">來源：{draft.sourceUrl}</p>
        )}

        <div className="mt-4 rounded-2xl bg-teal-50 p-4 text-sm leading-relaxed text-teal-900 ring-1 ring-teal-200/70">
          請掃一眼抽出來的內文對不對。
          <span className="mt-1 block text-xs text-teal-800/80">
            自動抽取常常會夾到圖說、「延伸閱讀」或訂閱提示——那些直接刪掉。
            教材的每一句引用都來自這裡，這份乾淨後面才準。
          </span>
        </div>

        <textarea
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          rows={14}
          className="mt-3 w-full rounded-xl border border-slate-300 p-3 text-sm leading-relaxed"
        />
        {/* 超過上限會被截掉。這裡的截斷比逐字稿嚴重——學習者會對照原文讀教材，
            所以存進去的跟分析的必須是同一份，不能讓畫面顯示分析沒看過的段落 */}
        {over ? (
          <p className="mt-1 text-xs text-amber-700">
            {draft.text.length} 字，只會用前面 {ARTICLE_MAX_CHARS} 字。
            想學後面那段的話，把前面刪掉再做一次。
          </p>
        ) : (
          <p className="mt-1 text-xs text-slate-400">
            {draft.text.length} 字。整篇都會進教材，分析會挑裡面最難拆的幾句。
          </p>
        )}

        {errorMsg ? <ErrorNote error={errorMsg} className="mt-3" /> : null}

        <button
          onClick={() => void build()}
          disabled={building}
          className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
        >
          {building ? '分析中，約需 25 秒…' : '做成教材'}
        </button>
      </main>
    )
  }

  // ── 文章首頁 ──────────────────────────────────────────
  return (
    <main className="mx-auto max-w-xl p-6 pb-16 lg:max-w-3xl">
      <header className="flex items-center justify-between pt-2">
        <div>
          <h1 className="text-2xl font-bold">文章</h1>
          <p className="mt-1 text-sm text-slate-500">真實文本・專治「字都認得卻讀不動」</p>
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
              onClick={() => setLanguage(l)}
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

      {articles && mine.length > 0 && (
        <section className="mt-5">
          <h2 className="px-1 font-bold text-slate-800">我的文章（{mine.length}）</h2>
          <p className="mt-0.5 px-1 text-xs text-slate-500">做過的教材都留著，可以回來重讀</p>
          <div className="mt-2 grid gap-3">
            {mine.map((a) => (
              <div key={a.id} className="relative">
                <Link
                  to={`/article/${a.id}`}
                  className="block rounded-2xl bg-white p-5 pr-16 shadow-sm ring-1 ring-slate-200/60 active:scale-[0.98]"
                >
                  <span className="block font-bold">{a.title}</span>
                  <span className="block text-sm text-slate-500">
                    {new Date(a.created_at).toLocaleDateString('zh-TW')}
                  </span>
                </Link>
                <button
                  onClick={() => void remove(a)}
                  aria-label={`刪除 ${a.title}`}
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
      {articles !== null && elsewhere > 0 && (
        <p className="mt-3 px-1 text-xs text-slate-500">
          其他語言還有 {elsewhere} 篇，切換上面的語言就看得到。
        </p>
      )}

      <section className="mt-6">
        <label className="block px-1 text-sm font-semibold text-slate-600" htmlFor="article-url">
          貼一篇文章的網址
        </label>
        <input
          id="article-url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://…"
          className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-sm"
        />
        <button
          onClick={() => void grab()}
          disabled={fetching || !urlInput.trim()}
          className="mt-3 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
        >
          {fetching ? '抓取中…' : '抓這一篇 📄'}
        </button>

        {miss && (
          <div className="mt-3 rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200/70">
            {ARTICLE_MISS_NOTE[miss]}
            <span className="mt-1 block text-xs text-amber-800/80">
              直接把內文選取複製，用下面那個按鈕貼進來就好。
            </span>
          </div>
        )}

        <button
          onClick={() => setDraft({ title: '', text: '', sourceUrl: '' })}
          className="mt-3 w-full rounded-xl bg-white py-3 font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200/60"
        >
          直接貼文章內容
        </button>
      </section>

      <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <h3 className="font-bold text-slate-800">不知道讀什麼？</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          這裡不做 AI 推薦——模型記不住哪篇文章真的存在，推薦一篇找不到的比不推薦更糟。
          下面是幾個好找的起點，各自的坑也寫了
        </p>
        <ul className="mt-3 space-y-2.5">
          {SOURCE_HINTS[language].map((s) => (
            <li key={s.name}>
              <p className="text-sm font-semibold text-slate-700">{s.name}</p>
              <p className="text-xs leading-relaxed text-slate-500">{s.note}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-slate-400">
          經典文學要小心：十九世紀的小說是沒有人在講的話，學起來會寫出古色古香但不自然的句子。
          想讀經典的話挑二十世紀中期之後的散文，而且只當閱讀素材、不要拿去練口說。
        </p>
      </section>
    </main>
  )
}
