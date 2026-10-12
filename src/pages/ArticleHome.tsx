// 文章學習首頁：AI 從今天的新聞裡挑／貼網址／貼全文 → AI 分析 → 做成教材
//
// ── AI 推薦為什麼不會推薦出不存在的文章 ────────────────────
//
// 模型記不住哪篇文章存在，憑記憶推薦就會得到點下去 404 的東西。
// 所以推薦分兩步：Worker 先從各家新聞的 RSS 抓回今天真的存在的標題，
// 模型只負責**從清單裡挑**、用索引回答；索引超出範圍的在驗證時就丟掉。
// 畫面上的標題與網址都來自 RSS，不是模型寫的，點下去一定是那篇。
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
  fetchFeeds,
  listArticles,
  suggestArticles,
  type ArticleMiss,
  type FeedSource,
  type ResolvedArticlePick,
} from '../lib/articleService'
import { ARTICLE_MAX_CHARS, ARTICLE_MIN_CHARS } from '../lib/prompts/article'
import { ClaudeError } from '../lib/claude'
import ErrorNote from '../components/ErrorNote'
import { isTaskLanguage, type Article, type TaskLanguage } from '../lib/types'

/** 幾個起步用的主題，省掉「要填什麼」的猶豫 */
const TOPIC_HINTS = ['科技', '科學', '生活', '健康', '文化', '商業']

/** 1-5 的難度畫成五個點。以學習者的程度為基準，不是絕對難度 */
function Difficulty({ value }: { value: number }) {
  const n = Math.max(1, Math.min(5, Math.round(value)))
  return (
    <span className="flex items-center gap-1 text-xs text-slate-500">
      難度
      <span className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={`h-1.5 w-1.5 rounded-full ${i <= n ? 'bg-amber-500' : 'bg-slate-200'}`} />
        ))}
      </span>
    </span>
  )
}

/** 一篇推薦。標題與來源都是 RSS 原文，why／caution／difficulty 才是 AI 的判斷 */
export function PickCard({
  pick,
  busy,
  opening,
  onOpen,
}: {
  pick: ResolvedArticlePick
  busy: boolean
  opening: boolean
  onOpen: () => void
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <p className="font-bold leading-snug">{pick.title}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs text-slate-400">{pick.source}</span>
        <Difficulty value={pick.difficulty} />
      </div>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{pick.why}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-amber-700">⚠️ {pick.caution}</p>
      <button
        onClick={onOpen}
        disabled={busy}
        className="mt-3 w-full rounded-xl bg-teal-50 py-3 font-bold text-teal-700 disabled:opacity-60"
      >
        {opening ? '抓全文中…' : '讀這篇'}
      </button>
    </div>
  )
}

/**
 * 自己找素材的起點。刻意只列「能合法自由使用」與「好找」的來源，
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

  const [topic, setTopic] = useState('')
  const [picks, setPicks] = useState<ResolvedArticlePick[] | null>(null)
  const [recommending, setRecommending] = useState(false)
  /** 各新聞來源今天抓不抓得到。有掛掉的要照實說，不然只會覺得推薦怎麼都同一家 */
  const [sources, setSources] = useState<FeedSource[]>([])
  /** 正在抓哪一篇推薦文章的全文（按鈕要顯示轉圈的是哪一張卡） */
  const [opening, setOpening] = useState<string | null>(null)

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

  async function grab(url = urlInput.trim(), fallbackTitle = '') {
    if (fetching || !url) return
    setFetching(true)
    setMiss(null)
    setErrorMsg('')
    const result = await fetchArticle(url)
    if ('text' in result) {
      // RSS 的標題比網頁 <title> 乾淨（不帶站名），從推薦進來的優先用它
      setDraft({ title: fallbackTitle || result.title, text: result.text, sourceUrl: url })
    } else {
      setMiss(result.miss)
      // 推薦進來卻抓不到全文：把網址留在輸入框，讓使用者知道是哪一篇、可以自己去複製
      if (fallbackTitle) setUrlInput(url)
    }
    setFetching(false)
  }

  /** 兩步：先抓今天真的存在的新聞清單，再請 AI 從裡面挑 */
  async function recommend() {
    if (!profile || recommending) return
    setRecommending(true)
    setErrorMsg('')
    setMiss(null)
    try {
      const feeds = await fetchFeeds(language)
      setSources(feeds.sources)
      if ('failed' in feeds) {
        setPicks(null)
        setErrorMsg(
          '今天的新聞清單抓不到（每一家都連不上）。可以先用下面「貼網址」或「直接貼內容」，' +
            '或等一下再試。',
        )
        return
      }
      const list = await suggestArticles(language, profile.level, feeds.items, topic, profile.interests ?? null)
      setPicks(list)
    } catch (e: unknown) {
      setErrorMsg(e instanceof ClaudeError ? e : `推薦失敗：${String((e as Error).message)}`)
    } finally {
      setRecommending(false)
    }
  }

  async function openPick(p: ResolvedArticlePick) {
    setOpening(p.link)
    await grab(p.link, p.title)
    setOpening(null)
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
              onClick={() => {
                setLanguage(l)
                setPicks(null)
                setSources([])
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

      {/* AI 推薦：先抓今天真的存在的新聞，再請 AI 從裡面挑——不可能推薦出不存在的文章 */}
      <section className="mt-6">
        <label className="block px-1 text-sm font-semibold text-slate-600" htmlFor="article-topic">
          想讀什麼主題？（可以不填）
        </label>
        <input
          id="article-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="例如：AI、氣候、運動"
          className="mt-1 w-full rounded-xl border border-slate-300 p-3"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {TOPIC_HINTS.map((t) => (
            <button
              key={t}
              onClick={() => setTopic(topic === t ? '' : t)}
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
          disabled={recommending}
          className="mt-4 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white disabled:opacity-60"
        >
          {recommending ? '正在讀今天的新聞，約需 15 秒…' : picks ? '換一批推薦' : '從今天的新聞推薦給我 📰'}
        </button>

        {/* 有來源掛掉就照實說。RSS 網址偶爾會改，不講的話只會覺得推薦怎麼都是同一家 */}
        {sources.some((src) => !src.ok) && (
          <p className="mt-2 px-1 text-xs leading-relaxed text-slate-400">
            今天抓不到：{sources.filter((src) => !src.ok).map((src) => src.name).join('、')}。
            {sources.some((src) => src.ok) && '推薦只從其他幾家挑。'}
          </p>
        )}

        {picks && (
          <>
            <p className="mt-4 px-1 text-xs leading-relaxed text-slate-500">
              這些都是今天真的刊出的文章——AI 只負責從清單裡挑，標題與網址都來自新聞網站本身。
              難度以你的程度 {profile.level} 為基準。
            </p>
            <div className="mt-3 grid gap-3">
              {picks.map((p) => (
                <PickCard
                  key={p.link}
                  pick={p}
                  busy={fetching}
                  opening={opening === p.link}
                  onOpen={() => void openPick(p)}
                />
              ))}
            </div>
          </>
        )}
      </section>

      <section className="mt-6">
        {/* 失敗訊息放在這一區最上面：從推薦卡點進來抓不到時，它就緊貼在卡片下方，看得到 */}
        {miss && (
          <div className="mb-3 rounded-2xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-200/70">
            {ARTICLE_MISS_NOTE[miss]}
            <span className="mt-1 block text-xs text-amber-800/80">
              打開下面那個網址，把內文選取複製，用「直接貼文章內容」貼進來就好。
            </span>
          </div>
        )}

        <label className="block px-1 text-sm font-semibold text-slate-600" htmlFor="article-url">
          或者，貼一篇你自己找的
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="article-url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://…"
            className="min-w-0 flex-1 rounded-xl border border-slate-300 p-3 text-sm"
          />
          <button
            onClick={() => void grab()}
            disabled={fetching || !urlInput.trim()}
            className="shrink-0 rounded-xl bg-white px-4 font-semibold text-teal-700 shadow-sm ring-1 ring-slate-200/60 disabled:opacity-50"
          >
            {fetching && !opening ? '抓取中…' : '抓取'}
          </button>
        </div>

        <button
          onClick={() => setDraft({ title: '', text: '', sourceUrl: '' })}
          className="mt-3 w-full rounded-xl bg-white py-3 font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200/60"
        >
          直接貼文章內容
        </button>
      </section>

      <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <h3 className="font-bold text-slate-800">想自己找的話</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          推薦只會從固定幾家新聞挑。想讀別的，這幾個是好找的起點，各自的坑也寫了
        </p>
        <ul className="mt-3 space-y-2.5">
          {SOURCE_HINTS[language].map((h) => (
            <li key={h.name}>
              <p className="text-sm font-semibold text-slate-700">{h.name}</p>
              <p className="text-xs leading-relaxed text-slate-500">{h.note}</p>
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
