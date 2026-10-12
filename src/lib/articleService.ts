// 文章教材的資料層：抓網址、做成教材、讀寫
//
// AI 在這裡的角色是**分析師不是作者**——跟歌曲、影片同一條規矩，
// 原文一律來自真實來源（使用者貼上，或 Worker 依網址抓一次），
// 模型不准重打、不准改寫。理由見 worker/src/prompts/articleLesson.ts。

import { supabase } from './supabase'
import { callClaudeJSON } from './claude'
import { loadAccessPassphrase } from './accessGate'
import {
  ARTICLE_MAX_CHARS,
  isArticleLesson,
  type ArticleLesson,
  type ArticleLessonInput,
} from './prompts/article'
import type { Article, Level, TaskLanguage } from './types'

export async function listArticles(profileId: string, limit = 100): Promise<Article[]> {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as Article[]
}

export async function getArticle(id: string, profileId: string): Promise<Article | null> {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .eq('id', id)
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Article | null) ?? null
}

/** 抓網址失敗的原因。每一種的處置不同，不要混成一句「抓不到」 */
export type ArticleMiss = 'bad_url' | 'blocked' | 'too_short' | 'not_html' | 'failed' | 'unreachable'

export const ARTICLE_MISS_NOTE: Record<ArticleMiss, string> = {
  bad_url: '這不像一個網址。要的是 https:// 開頭的公開新聞或文章頁。',
  blocked: '那個網站拒絕了我們的請求。',
  too_short: '只抓到很短的一段，多半是付費牆，或整頁要跑 JavaScript 才有內容。',
  not_html: '那個網址不是網頁（可能是 PDF 或影片）。',
  failed: '那一頁抓不到（可能已經下架或改網址了）。',
  unreachable: '連不上那個網站，等一下再試一次。',
}

export interface FetchedArticle {
  title: string
  text: string
}

/**
 * 依網址抓一次文章。
 *
 * 命中率應該比影片逐字稿高得多——新聞網站不像 YouTube 會擋機房 IP。
 * 抓不到就退回請使用者自己貼，跟其他模組同一套。
 */
export async function fetchArticle(url: string): Promise<FetchedArticle | { miss: ArticleMiss }> {
  const base = import.meta.env.VITE_WORKER_URL?.replace(/\/$/, '')
  if (!base) return { miss: 'unreachable' }

  const passphrase = loadAccessPassphrase()
  try {
    const res = await fetch(`${base}/api/article`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(passphrase ? { 'x-lgl-access': passphrase } : {}),
      },
      body: JSON.stringify({ url }),
    })
    const data = (await res.json().catch(() => null)) as {
      title?: string
      text?: string
      reason?: string
    } | null

    if (res.ok && data?.text) return { title: data.title ?? '', text: data.text }

    const known: ArticleMiss[] = ['bad_url', 'blocked', 'too_short', 'not_html', 'failed', 'unreachable']
    const reason = data?.reason
    return { miss: known.includes(reason as ArticleMiss) ? (reason as ArticleMiss) : 'failed' }
  } catch {
    return { miss: 'unreachable' }
  }
}

/** 把一篇文章做成教材並存起來 */
export async function createArticle(
  profileId: string,
  language: TaskLanguage,
  level: Level,
  title: string,
  text: string,
  sourceUrl: string,
): Promise<Article> {
  // 存進資料庫的跟送進 prompt 的是同一份，不然教材會講到畫面上沒有的句子
  const body = text.trim().slice(0, ARTICLE_MAX_CHARS)

  const lesson = await callClaudeJSON(
    {
      promptModule: 'articleLesson',
      vars: { language, level, title: title.trim(), text: body } satisfies ArticleLessonInput,
      messages: [{ role: 'user', content: '請把這篇文章做成閱讀教材' }],
      maxTokens: 3000,
    },
    isArticleLesson,
  )

  const { data, error } = await supabase
    .from('articles')
    .insert({
      profile_id: profileId,
      language,
      title: title.trim(),
      source_url: sourceUrl.trim() || null,
      body,
      lesson,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data as Article
}

export async function deleteArticle(id: string, profileId: string): Promise<void> {
  const { error } = await supabase.from('articles').delete().eq('id', id).eq('profile_id', profileId)
  if (error) throw new Error(error.message)
}

/** 從 jsonb 取出教材，壞掉就回 null（畫面顯示「這篇要重做」） */
export function readArticleLesson(article: Article): ArticleLesson | null {
  return isArticleLesson(article.lesson) ? article.lesson : null
}
