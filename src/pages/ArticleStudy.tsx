// 文章精讀
//
// 這一頁要回答的問題是：**為什麼字都認得，這篇卻讀不動。**
//
// 跟另外兩個教材模組刻意不同：
//   歌曲 → 這句能不能拿去用（旋律會扭曲語言）
//   影片 → 為什麼你聽不懂（連音、脫落、填充詞）
//   文章 → 為什麼你讀不動
//
// 版面順序就是教學順序：
//   1. 先讀原文（看得到全文，不是只有被挑出來的句子）
//   2. 長句解剖——讀不動長文九成是組不回那棵樹，不是生字
//   3. 指涉鏈——「該公司」指的是誰。中文習慣省略主詞，所以這條特別容易斷
//   4. 書面 → 口語——把「讀」接回「說」的橋。只讀不轉換會長出一張書面腔的嘴
//   5. 連接詞——漏讀一個，整段的立場就讀反了
//
// 刻意**沒有**逐句翻譯：給了對照譯文，眼睛會直接吃中文，原文等於沒讀。
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useProfile } from '../lib/profileContext'
import { getArticle, readArticleLesson } from '../lib/articleService'
import { harvestFromTask } from '../lib/vocabService'
import { logActivity } from '../lib/streakService'
import { speak, stopSpeaking } from '../lib/speech'
import type { ArticleLesson } from '../lib/prompts/article'
import type { Article } from '../lib/types'

export default function ArticleStudy() {
  const { articleId } = useParams()
  const navigate = useNavigate()
  const { profile } = useProfile()
  const [article, setArticle] = useState<Article | null>(null)
  const [lesson, setLesson] = useState<ArticleLesson | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile || !articleId) return
    let alive = true
    getArticle(articleId, profile.id)
      .then((a) => {
        if (!alive) return
        setArticle(a)
        if (a) setLesson(readArticleLesson(a))
      })
      .catch(() => alive && setArticle(null))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [profile, articleId])

  if (!profile) return null
  if (loading) return <p className="p-10 text-center text-slate-400">載入中…</p>

  if (!article || !lesson) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <p className="mt-10 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200/60">
          <span className="block font-semibold text-slate-700">這篇的教材讀不到</span>
          <span className="mt-2 block text-sm text-slate-500">
            可能是生成時被截斷了。回文章清單把它刪掉重做一次就好。
          </span>
        </p>
        <button
          onClick={() => navigate('/article')}
          className="mt-4 w-full rounded-xl bg-teal-600 py-3 font-bold text-white"
        >
          回文章清單
        </button>
      </main>
    )
  }

  return <ArticleLessonView article={article} lesson={lesson} profileId={profile.id} />
}

/**
 * 教材本體。跟讀取分開：這樣版面可以餵固定資料單獨渲染檢查，
 * 不必真的生成一篇教材才看得到長什麼樣。
 */
export function ArticleLessonView({
  article,
  lesson,
  profileId,
}: {
  article: Article
  lesson: ArticleLesson
  profileId: string
}) {
  const navigate = useNavigate()
  const [harvested, setHarvested] = useState<number | null>(null)
  const harvestingRef = useRef(false)
  /** 原文預設收起來：先看教材再回頭讀，比一開門就是一面文字牆好進去 */
  const [openText, setOpenText] = useState(false)

  useEffect(() => stopSpeaking, [])

  async function harvest() {
    if (harvestingRef.current || lesson.chunks.length === 0) return
    harvestingRef.current = true
    const n = await harvestFromTask(
      profileId,
      article.language,
      lesson.chunks.map((c) => ({ word: c.text, meaning_zh: c.zh, example: c.usage })),
    ).catch(() => 0)
    setHarvested(n)
    void logActivity(profileId).catch(() => undefined)
    harvestingRef.current = false
  }

  function say(text: string) {
    void speak(text, article.language).catch(() => undefined)
  }

  return (
    <main className="mx-auto max-w-xl p-6 pb-16 lg:max-w-3xl">
      <header className="flex items-start justify-between gap-3 pt-2">
        <h1 className="min-w-0 text-xl font-bold leading-snug">{article.title}</h1>
        <Link
          to="/article"
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

      {lesson.register && (
        <p className="mt-2 px-1 text-xs leading-relaxed text-slate-500">📰 {lesson.register}</p>
      )}

      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <button
          onClick={() => setOpenText((v) => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <span className="font-bold text-slate-800">原文（{article.body.length} 字）</span>
          <span className="text-sm text-slate-400">{openText ? '收起' : '展開'}</span>
        </button>
        {openText && (
          <>
            <p className="mt-3 whitespace-pre-line text-base leading-loose text-slate-800">
              {article.body}
            </p>
            {article.source_url && (
              <a
                href={article.source_url}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block break-all text-xs text-slate-400"
              >
                來源：{article.source_url}
              </a>
            )}
          </>
        )}
      </section>

      {/* 長句解剖放最前面：讀不動長文九成是組不回那棵樹，不是生字 */}
      <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
        <h3 className="font-bold text-slate-800">長句解剖（{lesson.sentences.length} 句）</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          讀不動不是生字的問題——查一下就知道了。卡住你的是一句話套了三層子句
        </p>
        <ul className="mt-3 space-y-4">
          {lesson.sentences.map((s, i) => (
            <li key={i} className="border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 text-base leading-relaxed text-slate-800">{s.original}</p>
                <button
                  onClick={() => say(s.original)}
                  aria-label="唸這一句"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-50 text-teal-600 ring-1 ring-slate-200/70 active:bg-slate-100"
                >
                  🔊
                </button>
              </div>
              <div className="mt-2 rounded-xl bg-teal-50 p-3">
                <p className="text-xs font-semibold text-teal-800">骨幹</p>
                <p className="mt-0.5 text-sm font-semibold leading-relaxed text-teal-900">{s.backbone}</p>
              </div>
              {s.note && <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{s.note}</p>}
            </li>
          ))}
        </ul>
      </section>

      {/* 中文習慣省略主詞，所以台灣學習者對定指回指特別容易斷線 */}
      {lesson.refs.length > 0 && (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="font-bold text-slate-800">這些字指的是誰</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            指涉一斷，後面整段就看不懂了。中文會省略主詞，這幾個語言不會
          </p>
          {/* 一筆兩行而不是一行內用箭頭串：指涉對象常常是一整個名詞片語，
              擠在同一行會折行，箭頭被留在上一行的尾巴，反而看不出對應關係 */}
          <ul className="mt-3 space-y-1.5">
            {lesson.refs.map((r, i) => (
              <li key={i} className="rounded-xl bg-slate-50 px-3 py-2">
                <p className="text-sm font-bold text-slate-800">{r.pointer}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">↳ {r.refers_to}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 把「讀」接回「說」的橋。只讀不轉換的人會長出一張書面腔的嘴 */}
      {lesson.spoken.length > 0 && (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="font-bold text-slate-800">同樣的意思，用講的會怎麼說</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            新聞體是書面語。照著講會很怪——這一區就是在拆那層外殼
          </p>
          <ul className="mt-3 space-y-3">
            {lesson.spoken.map((s, i) => (
              <li key={i} className="rounded-xl bg-slate-50 p-3">
                <p className="text-sm">
                  <span className="mr-1.5 rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-700">
                    寫
                  </span>
                  <span className="text-slate-600">{s.written}</span>
                </p>
                <p className="mt-1.5 text-sm">
                  <span className="mr-1.5 rounded bg-teal-100 px-1.5 py-0.5 text-xs font-bold text-teal-700">
                    說
                  </span>
                  <span className="font-semibold text-slate-800">{s.said}</span>
                </p>
                {s.note && <p className="mt-1 text-xs leading-relaxed text-slate-500">{s.note}</p>}
                <button
                  onClick={() => say(s.said)}
                  className="mt-2 w-full rounded-lg bg-white py-2 text-xs font-semibold text-teal-700 ring-1 ring-slate-200"
                >
                  🔊 聽口語版，然後自己講一次
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lesson.connectives.length > 0 && (
        <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
          <h3 className="font-bold text-slate-800">論述的骨架</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
            漏讀一個連接詞，整段的立場就會讀反
          </p>
          <ul className="mt-3 space-y-1.5">
            {lesson.connectives.map((c, i) => (
              <li key={i} className="flex items-baseline gap-2.5 rounded-xl bg-slate-50 px-3 py-2">
                <span className="shrink-0 text-sm font-bold text-slate-700">{c.word}</span>
                <span className="min-w-0 text-xs leading-relaxed text-slate-500">{c.role}</span>
              </li>
            ))}
          </ul>
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
          navigate('/article')
        }}
        className="mt-6 w-full rounded-xl bg-teal-600 py-3.5 font-bold text-white"
      >
        讀完了
      </button>
    </main>
  )
}
