// 從 HTML 抽出可讀的文章本文——純函式，可獨立測試
//
// 不用任何 readability 套件：Worker 要保持輕量，而我們要的東西其實很窄——
// 標題，加上段落文字。抽不乾淨也沒關係，使用者看得到抽出來的結果，
// 可以直接在畫面上修，或者整段重貼。
//
// 新聞網站跟 YouTube 不同，多半不會擋機房 IP，所以這條路的命中率
// 比 /api/transcript 高得多。抓不到的典型原因是付費牆與整頁靠 JS 才渲染，
// 兩者都會抽出一篇很短的東西——所以呼叫端用長度當判準。

export interface ExtractedArticle {
  title: string
  text: string
}

/** 常見的 HTML 實體。只處理這幾個就夠了，文章本文裡不會有太奇怪的東西 */
const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&rsquo;': '’',
  '&lsquo;': '‘',
  '&ldquo;': '“',
  '&rdquo;': '”',
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&[a-zA-Z#0-9]+;/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
}

/** 把一段 HTML 片段變成純文字 */
function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/[ \t ]+/g, ' ').trim()
}

/** 拿掉那些內容一定不是文章本文的區塊 */
function removeNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|iframe|form|template)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(nav|aside|header|footer)\b[\s\S]*?<\/\1>/gi, '')
}

function firstMatch(html: string, re: RegExp): string {
  const m = re.exec(html)
  return m ? stripTags(m[1]) : ''
}

/**
 * 標題：og:title 最準（那是給分享用的，通常已經去掉站名），
 * 其次 h1，最後退回 <title>（常常帶著「 - 某某新聞網」的尾巴）
 */
export function extractTitle(html: string): string {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html)
  if (og) return decodeEntities(og[1]).trim()

  const h1 = firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  if (h1) return h1

  const title = firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i)
  // 去掉「標題 - 站名」「標題｜站名」的尾巴，但只在前半夠長時才切，
  // 不然會把本來就很短的標題切沒了
  const cut = title.split(/\s[-–—|｜]\s/)[0]
  return cut.length >= 8 ? cut : title
}

/**
 * 本文：優先取 <article> 裡的段落；沒有就全頁掃 <p>。
 *
 * 只收 <p> 而不是整頁文字，是因為導覽列與版權宣告幾乎不會包在 <p> 裡；
 * 太短的段落（分享按鈕、圖說、「更多報導」）一律丟掉。
 */
export function extractBody(html: string): string {
  const clean = removeNoise(html)
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(clean)
  const scope = article ? article[1] : clean

  const paras: string[] = []
  for (const m of scope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = stripTags(m[1])
    // 中日韓一句就可能只有 20 字元，英文一段起碼 40——取中間值當門檻
    if (t.length >= 25) paras.push(t)
  }

  return paras.join('\n\n')
}

export function extractArticle(html: string): ExtractedArticle {
  return { title: extractTitle(html), text: extractBody(html) }
}
