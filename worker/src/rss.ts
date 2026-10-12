// RSS／Atom 解析——純函式，可獨立測試
//
// 文章推薦的素材池來自新聞網站自己發佈的 RSS。這是 AI 推薦文章能成立的關鍵：
// 模型不憑記憶推薦（它記不住哪篇存在），而是**從今天真的存在的標題裡挑**，
// 用索引回答。索引超出範圍就丟掉——結構上就不可能推薦出一篇不存在的文章。
//
// 跟影片的做法不同：影片那邊 AI 只能給搜尋字串，因為 YouTube 沒有「今天的清單」
// 可以先拿給它看。新聞有，所以這裡可以做得更好。

import { decodeEntities } from './articleExtract'

export interface FeedItem {
  title: string
  link: string
  /** RSS 的摘要，去掉 HTML；沒有就是空字串 */
  summary: string
}

/** 拿掉 CDATA 外殼與 HTML 標籤（摘要裡常夾著 <img> 或 <p>） */
function clean(raw: string): string {
  const unwrapped = raw.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
  // 先解實體再拆標籤：有些 feed 把 HTML 整段跳脫成 &lt;p&gt; 放在摘要裡
  return decodeEntities(unwrapped)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  return m ? clean(m[1]) : ''
}

/** Atom 的連結放在屬性裡：<link href="…" rel="alternate"/> */
function atomLink(block: string): string {
  const alt = /<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i.exec(block)
    ?? /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i.exec(block)
  if (alt) return decodeEntities(alt[1])
  const any = /<link\b[^>]*href=["']([^"']+)["']/i.exec(block)
  return any ? decodeEntities(any[1]) : ''
}

/**
 * 解析一份 RSS 2.0 或 Atom。
 *
 * 寬鬆處理：缺標題或缺連結的條目直接丟掉（沒有連結就抓不到全文，留著也沒用），
 * 摘要只取前 200 字——送進 prompt 的是幾十則，每則太長會白白吃 token，
 * 而判斷「適不適合這個程度」看標題與一兩句摘要就夠了。
 */
export function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = []

  const isAtom = /<feed\b/i.test(xml) && !/<rss\b/i.test(xml)
  const blockRe = isAtom ? /<entry\b[\s\S]*?<\/entry>/gi : /<item\b[\s\S]*?<\/item>/gi

  for (const m of xml.matchAll(blockRe)) {
    const block = m[0]
    const title = tag(block, 'title')
    const link = isAtom ? atomLink(block) : tag(block, 'link') || tag(block, 'guid')
    if (!title || !/^https?:\/\//.test(link)) continue

    const summary = (isAtom ? tag(block, 'summary') || tag(block, 'content') : tag(block, 'description'))
      .slice(0, 200)

    items.push({ title, link, summary })
  }

  return items
}

/**
 * 把多個來源的條目合在一起：去掉重複連結，各來源輪流取，避免整串都是同一家。
 *
 * 輪流取而不是直接串接，是因為各家的 feed 長度差很多——一家給 50 則、
 * 一家給 10 則的話，截到上限之後幾乎全是第一家的，推薦就失去多樣性。
 */
export function mergeFeeds(
  groups: Array<{ source: string; items: FeedItem[] }>,
  limit: number,
): Array<FeedItem & { source: string }> {
  const seen = new Set<string>()
  const out: Array<FeedItem & { source: string }> = []
  const cursors = groups.map(() => 0)

  let progressed = true
  while (out.length < limit && progressed) {
    progressed = false
    for (let g = 0; g < groups.length && out.length < limit; g++) {
      const { source, items } = groups[g]
      while (cursors[g] < items.length) {
        const item = items[cursors[g]++]
        if (seen.has(item.link)) continue
        seen.add(item.link)
        out.push({ ...item, source })
        progressed = true
        break
      }
    }
  }

  return out
}
