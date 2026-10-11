// 影片分段教學：把一段真實口語變成「為什麼你聽不懂」的解答
//
// ── 這支跟歌曲教材刻意走不同的路 ───────────────────────────
//
// 歌曲要逐行標「能不能拿去用」，因為旋律會為了押韻與音節數扭曲語言。
// 真實影片相反——它就是真的口語，問題從來不是「能不能拿去用」，
// 而是**你為什麼聽不懂**。照抄歌曲的設計會做出一份沒搔到癢處的教材。
//
// 真實口語聽不懂的三大來源，而課本幾乎都不教：
//
// 1. 連音與脫落。字典上的 what do you 在嘴裡是 whaddaya，
//    〜ている 是〜てる，무엇을 是 뭘。學習者聽到的聲音跟他背過的形狀對不起來，
//    於是整句崩掉——不是單字不夠，是那個字根本沒以他認得的樣子出現。
// 2. 填充詞與話語標記。you know、I mean、like、えーと、なんか、まあ。
//    這些沒有字典意義，所以學習者會試圖解讀它們，然後跟不上後面的內容。
//    知道「這是在拖時間、可以跳過」本身就是一種聽力技能。
// 3. 腔調。t-flapping、非捲舌、母音位移這些不是「口音很重」，是系統性的規則，
//    講清楚一次就能聽懂一整類人講話。
//
// 所以這支的輸出重心是上面三件事，逐行翻譯只是配角。

import type { Level, TaskLanguage } from './types'

export interface VideoLessonInput {
  language: TaskLanguage
  level: Level
  title: string
  /** 使用者從 YouTube 的「顯示轉錄稿」複製貼上的逐字稿（可能含時間戳） */
  transcript: string
}

/** 各語言的連音與脫落長什麼樣 */
const REDUCTION_GUIDE: Record<TaskLanguage, string> = {
  英文:
    'what do you→whaddaya、going to→gonna、want to→wanna、got to→gotta、' +
    'kind of→kinda、let me→lemme、give me→gimme、them→\'em、and→\'n、' +
    '以及連音（an apple 聽起來像 a napple）與 t 的彈舌（water→wader）',
  日文:
    '〜ている→〜てる、〜ておく→〜とく、〜てしまう→〜ちゃう／〜じゃう、' +
    '〜なければ→〜なきゃ、〜のだ→〜んだ、わからない→わかんない、' +
    'そうですか→そっすか、以及助詞整個省略（ご飯（を）食べた？）',
  韓文:
    '이것은→이건、그것이→그게、무엇을→뭘、〜하고 있어→하고있어 的連讀、' +
    '以及終聲與下一個字首的連音變化',
}

/** 各語言的填充詞與話語標記 */
const FILLER_GUIDE: Record<TaskLanguage, string> = {
  英文: 'you know、I mean、like、actually、basically、sort of、well、so、right?、kind of',
  日文: 'えーと、あの、なんか、まあ、やっぱり、ちょっと、〜っていうか、ね、よね',
  韓文: '그、그니까、뭐、약간、진짜、아니 (當轉折用，不是否定)、〜잖아요',
}

export function videoLessonSystemPrompt(input: VideoLessonInput): string {
  return `你是語言教師，正在把一段真實的${input.language}影片做成聽力教材。

輸入變數：
- 語言：${input.language}
- 程度：${input.level}
- 影片標題：${input.title}

以下是使用者從 YouTube 複製的逐字稿：
"""
${input.transcript}
"""

最高原則（優先於下面所有要求）：
**逐字稿就是唯一的事實來源，一個字都不要改。**
不可以依你的印象「修正」用詞、不可以補上你覺得漏掉的內容、不可以潤飾成書面語。
自動辨識的逐字稿本來就會有錯字與缺標點，那是真實情況——照抄你拿到的東西。
真的看不懂某一行在講什麼，就照抄原文並在 note 說明「這行逐字稿可能有誤」。

**這不是歌詞教材。** 不要標「這句能不能拿去用」——真實口語本來就能用。
這份教材要回答的是另一個問題：**為什麼這段用耳朵聽會聽不懂。**

硬性要求：
1. 從逐字稿裡挑**一段最值得精聽的 8-15 行**（不是整支影片）。挑的標準是
   「語言密度高、而且聽起來會跟字面差很遠」的那一段，通常不是開頭的招呼語。
   整份教材是一次產出的，貪心會逾時
2. gist：兩三句話說這段在講什麼，讓學習者先有脈絡再進去聽細節
3. lines：那一段的逐行。每行給
   - text：逐字稿原文（原封不動）
   - zh：自然的繁體中文意思，不要逐字直譯
   - tricky：true／false——**這句用耳朵聽會不會跟字面差很多**。
     會的話 heard 欄位寫出「實際聽起來像什麼」（用拼音或近似寫法），
     note 一句話說明是哪一種變化。不會就兩欄留空字串
4. reductions：這段裡實際出現的連音與脫落，2-5 個（沒有就空陣列）。
   written 寫字典形、spoken 寫嘴裡的形、note 一句話說明規則。
   常見的有：${REDUCTION_GUIDE[input.language]}
   **這一項是整份教材最重要的部分**——聽不懂母語者講話，九成是這個而不是單字不夠
5. fillers：這段裡出現的填充詞與話語標記（沒有就空陣列）。
   word 寫那個詞、role 一句話說明它在做什麼（拖時間／轉折／緩和語氣／確認對方在聽）。
   常見的有：${FILLER_GUIDE[input.language]}
   要明講哪些可以直接當成雜訊跳過——學習者會卡住往往是因為想去解讀它們
6. accent：一兩句話描述這個說話者的腔調特徵，並指出一個可辨識的規則
   （例如「美式的 t 在母音之間會變成彈舌音，better 聽起來像 bedder」）。
   聽不出來或素材不足就寫「這段聽不出明顯的地域特徵」，不要硬掰
7. chunks：2-4 個可以整段帶走的語塊（不是單字、不是完整句子）

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "gist": "",
  "accent": "",
  "lines": [
    {"text": "", "zh": "", "tricky": true, "heard": "", "note": ""}
  ],
  "reductions": [{"written": "", "spoken": "", "note": ""}],
  "fillers": [{"word": "", "role": ""}],
  "chunks": [{"text": "", "zh": "", "usage": ""}]
}`
}
