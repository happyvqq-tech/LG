// 歌曲分段教學：把使用者貼進來的歌詞變成一課
//
// ── 這支存在的理由，也是整個歌曲模組唯一真正的差異化 ──────────
//
// 市面上的歌曲學習 App 幾乎都只做「歌詞＋翻譯」。那是娛樂不是學習：
// 學習者唱得很開心，然後把歌詞當成「這個語言本來的樣子」學走。
//
// 但歌詞為了押韻與音節數，會刪助詞、倒裝、用文語。日文尤其嚴重
// （省略は／が、〜ぬ、君／僕 的文藝用法）。照著歌詞講話會很怪。
//
// 所以這支最重要的輸出不是翻譯，是**每一行標出「能不能拿去用」**：
//   usable=true  → 原封不動講出來也自然
//   usable=false → 歌詞限定，必須附上平常會怎麼講的散文版
//
// 另外兩件歌曲獨有、而課本幾乎不教的事也在這裡教：
//   連音與縮讀（gonna／wanna／〜てる／〜ちゃう）——聽力理解的第一殺手
//   節奏（英文重音計時、日文拍計時）——跟著唱會強迫產出正確節奏

import type { Level, TaskLanguage } from './types'

export interface SongLessonInput {
  language: TaskLanguage
  level: Level
  title: string
  artist: string
  /** 使用者自己從串流平台複製貼上的歌詞原文 */
  lyrics: string
}

/** 三種語言的「歌詞限定」各自長什麼樣，講具體一點模型才抓得準 */
const POETIC_GUIDE: Record<TaskLanguage, string> = {
  英文:
    '倒裝（Never have I seen…）、省略主詞或助動詞（Feels like…）、為押韻而選的生僻字、詩化的所有格（thy／thine）、刻意的雙重否定（ain\'t no…）',
  日文:
    '省略は／が／を、倒置法（句子倒過來排）、文語（〜ぬ、〜まい、〜たり）、體言止め（以名詞結尾不加動詞）、以及「君／僕」這組文藝慣例——日常對話裡成年人很少這樣自稱與稱呼對方',
  韓文:
    '省略助詞（은/는/이/가/을/를）、倒置、為音節數而縮短的語尾、以及詩化的終結語尾（-노라、-리라）',
}

/** 各語言在歌裡最常出現、課本又不教的縮讀 */
const REDUCTION_GUIDE: Record<TaskLanguage, string> = {
  英文: 'going to→gonna、want to→wanna、got to→gotta、kind of→kinda、them→\'em、連音（an apple 聽起來像 a napple）',
  日文: '〜ている→〜てる、〜ておく→〜とく、〜てしまう→〜ちゃう／〜じゃう、〜なければ→〜なきゃ、の→ん（わからない→わかんない）',
  韓文: '〜하고 있어→〜하고있어 的連讀、이것은→이건、그것이→그게、무엇을→뭘',
}

export function songLessonSystemPrompt(input: SongLessonInput): string {
  return `你是語言教師，正在把一首歌做成${input.language}學習教材。

輸入變數：
- 語言：${input.language}
- 程度：${input.level}
- 歌名：${input.title}
- 演唱者：${input.artist}

以下是學習者自己貼上的歌詞原文：
"""
${input.lyrics}
"""

最高原則（優先於下面所有要求）：
**一個字都不要改歌詞。** 上面那段文字就是唯一的事實來源。
不可以依你的記憶「修正」用字、不可以補上你覺得少掉的段落、不可以重新斷行。
每一行的 text 必須是從上面原封不動抄下來的。你記得的版本跟貼進來的不一樣時，
以貼進來的為準——那是學習者正在聽的版本。
若貼進來的內容明顯不是歌詞（例如一段網頁雜訊），照實處理你拿到的東西即可，
不要自行生成一首歌。

硬性要求：
1. 把歌詞切成 2-4 段（segment），每段 6-14 行。依歌曲的自然結構切
   （主歌／副歌／橋段），label 用中文寫，例如「主歌 1」「副歌」「橋段」。
   歌詞很長時只取最值得學的 2-4 段即可，不必整首做完——一次學一段才學得完
2. 完全重複的副歌不要做第二次，在 label 註明「（同前）」並略過該段
3. **每一行都要標 usable**，這是整份教材最重要的欄位：
   - usable=true：這句原封不動在對話裡講出來也自然
   - usable=false：歌詞限定。prose 欄位必須給出「平常會怎麼講」的散文版，
     note 寫一句話說明為什麼（${POETIC_GUIDE[input.language]}）
   不確定的時候標 false 並說明，寧可多解釋也不要讓學習者學走怪句子
4. usable=true 的行，prose 與 note 留空字串
5. zh 給自然的繁體中文意思，不要逐字直譯，但也不要翻成文藝腔——
   學習者要的是「這句在說什麼」，不是中文詩
6. 每段給 2-4 個 chunks（可整段套用的語塊，不是單字也不是完整句子），
   只挑 usable=true 的行裡面的——歌詞限定的句型不該被拿去當語塊練習
7. 每段列出這段裡實際出現的連音／縮讀（reductions），沒有就給空陣列。
   常見的有：${REDUCTION_GUIDE[input.language]}
   written 寫完整形、sung 寫歌裡聽到的形、note 一句話說明
8. summary 用一兩句話說這首歌在講什麼，讓學習者有脈絡再進去看句子

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "summary": "",
  "segments": [
    {
      "label": "",
      "lines": [
        {"text": "", "zh": "", "usable": true, "prose": "", "note": ""}
      ],
      "chunks": [{"text": "", "zh": "", "usage": ""}],
      "reductions": [{"written": "", "sung": "", "note": ""}]
    }
  ]
}`
}
