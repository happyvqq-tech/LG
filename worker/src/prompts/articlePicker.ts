// 文章推薦：從今天真實存在的新聞標題裡挑，用索引回答
//
// ── 為什麼這支可以推薦，而影片那支只能給搜尋字串 ───────────
//
// 模型記不住哪篇文章存在。讓它憑記憶推薦，就會得到標題漂亮、
// 網址點下去 404 的東西——那比不推薦更糟。
//
// 影片那邊沒辦法先拿一份「今天的清單」給它看，只好退一步讓它給搜尋方向。
// 新聞可以：各家網站自己發佈 RSS，Worker 先把今天的標題抓回來，
// 模型只負責**從清單裡挑**，而且用索引回答。前端驗證時索引超出範圍就丟掉——
// 結構上就不可能推薦出一篇不存在的文章。
//
// ── 模型在這裡真正能貢獻的是什麼 ─────────────────────────
//
// 不是「找文章」（清單已經有了），是**判斷**：
//   - 這篇對 B1 來說吃不吃得下？政策與財經報導句子長、名詞化密集；
//     人物特稿與科普解說通常好進很多
//   - 這篇是什麼體裁？即時快訊多半是引述拼起來的，讀了學不到論述骨架
//   - 跟學習者的興趣有沒有關係？
// 而每一篇都要寫出它的坑，沒有缺點的素材不存在。

import type { Level, TaskLanguage } from './types'

export interface ArticlePickerInput {
  language: TaskLanguage
  level: Level
  /** 使用者想讀的主題（自由輸入，可空） */
  topic?: string
  interests?: string
  /** Worker 從 RSS 抓回來的真實條目，順序就是索引 */
  items: Array<{ title: string; summary: string; source: string }>
}

export function articlePickerSystemPrompt(input: ArticlePickerInput): string {
  const topic = input.topic?.trim()
  const interests = input.interests?.trim()
  const list = input.items
    .map((it, i) => `[${i}] (${it.source}) ${it.title}${it.summary ? `\n    ${it.summary}` : ''}`)
    .join('\n')

  return `你是語言教師，正在從今天的${input.language}新聞裡，替一位學習者挑幾篇值得精讀的文章。

輸入變數：
- 語言：${input.language}
- 學習者程度：${input.level}
- 想讀的主題：${topic && topic.length > 0 ? topic : '不限'}
- 學習者的興趣與近況：${interests && interests.length > 0 ? interests : '未提供'}

以下是今天實際存在的文章清單，方括號裡的數字是索引：
"""
${list}
"""

最高原則：**只能從上面的清單裡挑，用索引回答。**
不要推薦清單以外的文章，不要改寫標題，不要編造網址。
清單裡沒有合適的，就少挑幾篇——挑三篇好的勝過湊滿五篇。

硬性要求：
1. 挑 3-5 篇。每篇給：
   - index：清單裡的索引數字
   - why：為什麼適合這位 ${input.level} 的學習者，要具體
     （例如「人物特稿，敘事順著時間走，長句不多」），
     不要寫「內容有趣、適合學習」這種沒有資訊的話
   - caution：這篇難在哪。每篇都要寫，沒有缺點的素材不存在
     （例如「財經報導，名詞化很密，the implementation of 這類結構會一直出現」）
   - difficulty：1-5 的整數，1 最好進、5 最難。以這位學習者的程度為基準，不是絕對難度
2. 判斷難度的線索：
   - 政策、財經、法律報導——句子長、名詞化與被動語態密集，偏難
   - 人物特稿、生活、科普解說——敘事性強、有具體場景，通常好進
   - 即時快訊——句子短但多半是引述拼起來的，學不到論述骨架，除非沒得選否則少挑
3. 挑的幾篇要分散：不要全是同一家、同一種體裁，難度最好有高有低，
   讓學習者自己決定今天要挑戰還是放鬆
${topic && topic.length > 0 ? `4. 優先挑跟「${topic}」有關的；清單裡沒有相關的就照一般原則挑，並在 why 裡說明` : ''}
${interests && interests.length > 0 ? '5. 跟學習者興趣相關的可以加分，但「讀得下去」仍優先於投其所好' : ''}

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "picks": [
    {"index": 0, "why": "", "caution": "", "difficulty": 3}
  ]
}`
}
