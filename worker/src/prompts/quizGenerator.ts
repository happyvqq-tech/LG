// 每日測驗出題：針對已學過的字，出「全新情境」的填空題
//
// 關鍵設計：句子必須是新的，不能沿用單字卡上那句例句。
// 沿用的話測到的是「記不記得那句話」，不是「會不會用這個字」。

import type { TaskLanguage, VocabCard } from './types'

export const BLANK = '___'

export interface QuizGenInput {
  language: TaskLanguage
  exam: string
  examLevel: string
  cards: VocabCard[]
}

export function quizGeneratorSystemPrompt(input: QuizGenInput): string {
  const list = input.cards
    .map((c, i) => {
      const known = c.example ? `（單字卡既有例句：${c.example}）` : ''
      return `${i + 1}. ${c.word}${c.reading ? `／${c.reading}` : ''}｜${c.pos} ${c.meaning_zh}${known}`
    })
    .join('\n')

  return `你是${input.language}測驗命題老師，對象是準備 ${input.exam} ${input.examLevel} 的台灣學習者。

針對以下 ${input.cards.length} 個單字各出一題填空題，順序與數量必須完全一致：
${list}

命題規則（違反任一條即為不合格）：
1. 句子必須是**全新情境**。若上面附了既有例句，你出的句子在情境、主詞、場景上都要和它不同，不能只換幾個字
2. 挖空處一律寫成 ${BLANK}（三個底線），**整句只能有一個 ${BLANK}**
3. 句子裡**絕對不可以出現該單字本身**（含變化形），否則等於送分
4. 上下文要留足夠線索，讓懂這個字的人能推出答案；不要出成猜謎，也不要出成隨便填什麼都通
5. 難度貼近 ${input.exam} ${input.examLevel} 的實際出題，場景要真實
6. 每題附 hint：不透露答案，只點出「這裡要填的是什麼概念」（例如「表示『正式採用並執行』的動詞」）
7. ${
    // 日文與韓文的用言在句子裡一定要活用，硬要求「原形填進去」會逼出不自然
    // 甚至不合文法的句子，所以這兩種語言改成以辭書形／기본형 為答案基準，
    // 但活用後才是填進句子裡的實際文字——這就是為什麼下面另外要求 answer_surface
    input.language === '日文'
      ? '句子用普通体（不要です・ます），因為所有文型都接在普通形上，用丁寧体出題等於在考一個中高級用不到的形式；answer_surface 請給活用後實際要填入的形式（例如辭書形是「確認する」，句子需要て形時 answer_surface 就填「確認して」）'
      : input.language === '韓文'
        ? '句子用해요體；answer_surface 請給활용後實際要填入的形式（例如기본형是「심각하다」，句子需要해요體時 answer_surface 就填「심각해요」）'
        : '答案以原形為準；若句子文法上需要變化形，請調整句子讓原形能直接填入，此時 answer_surface 與 word 相同'
  }
8. answer_surface 是唯一用來核對使用者作答的欄位，必須是真的能讓 ${BLANK} 處讀起來通順的那個文字——不是辭書形/기본형的話就不要跟 word 寫一樣的

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "questions": [
    {"word":"對應的單字","sentence":"含一個 ${BLANK} 的句子","sentence_zh":"整句中文翻譯","hint":"不透露答案的提示","answer_surface":"填入 ${BLANK} 處的實際文字（活用/敬語變化後的形式；不需要變化的語言就等於 word）"}
  ]
}`
}
