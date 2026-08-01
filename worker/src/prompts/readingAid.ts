// 聽力稿的「讀音輔助」——日文標假名、韓文標實際發音
//
// 為什麼這兩個語言需要、英文不需要：
//
// 日文：B1 學習者的瓶頸有很大一部分在漢字讀音，不在文法。看得懂
//   「彼は毎日図書館で勉強する」但唸不出來，耳朵聽到的和眼睛認識的就是
//   兩套系統，永遠接不起來。更糟的是沒有標音時，中文母語者會自動用中文音
//   去讀日文漢字，這個習慣一旦固化極難矯正。
//
// 韓文：拼寫與發音的落差是系統性的，不是例外（연음화、비음화、경음화…）。
//   「좋아요」寫作 joh-a-yo 唸作 [조아요]。照拼寫記的人聽到真實語流會完全
//   對不起來，而且通常不知道自己卡在這裡，只會覺得「他們講太快」。
//
// 英文的拼寫與發音雖然也不規則，但學習者本來就是靠聽學發音，
// 額外標音標（KK/IPA）對 B1+ 的幫助遠不如前兩者，故不提供。
//
// 沿用批改回饋器（grader/sonnet）模組：讀音正確性比生成速度重要得多，
// 標錯一個音比沒標更糟。結果快取在 task_json，同一篇不會重複呼叫。

import type { Language, TaskLanguage } from './types'

/** 日文假名標記格式：漢字詞用 [漢字|かんじ] 包起來 */
export const RUBY_OPEN = '['
export const RUBY_SEP = '|'
export const RUBY_CLOSE = ']'

export interface ReadingAidInput {
  language: TaskLanguage
  sentences: string[]
}

export function readingAidSystemPrompt(input: ReadingAidInput): string {
  const numbered = input.sentences.map((s, i) => `${i + 1}. ${s}`).join('\n')
  const count = input.sentences.length

  const rules =
    input.language === '日文'
      ? `請為每一句的漢字標上假名讀音。

硬性要求：
1. 只在漢字上標音，格式為 ${RUBY_OPEN}漢字${RUBY_SEP}かな${RUBY_CLOSE}
2. 以「詞」為單位標，不要逐字拆開：
   ○ ${RUBY_OPEN}図書館${RUBY_SEP}としょかん${RUBY_CLOSE}
   ✗ ${RUBY_OPEN}図${RUBY_SEP}と${RUBY_CLOSE}${RUBY_OPEN}書${RUBY_SEP}しょ${RUBY_CLOSE}${RUBY_OPEN}館${RUBY_SEP}かん${RUBY_CLOSE}
3. 數字＋量詞的音便要標在整組上，例如 ${RUBY_OPEN}一杯${RUBY_SEP}いっぱい${RUBY_CLOSE}、${RUBY_OPEN}三本${RUBY_SEP}さんぼん${RUBY_CLOSE}
4. 送假名留在標記外：「読んだ」標成 ${RUBY_OPEN}読${RUBY_SEP}よ${RUBY_CLOSE}んだ
5. 平假名、片假名、標點、阿拉伯數字、英文字母原樣保留，不要加任何標記
6. 除了加上標記之外，不可更動原句的任何一個字`
      : `請寫出每一句「實際唸出來」的發音。

硬性要求：
1. 用韓文字母寫出套用音變之後的實際發音，例如：
   좋아요 → 조아요（ㅎ탈락）
   학년 → 항년（비음화）
   같이 → 가치（구개음화）
   먹었어요 → 머거써요（연음화）
2. 要處理的音變至少包含：연음화、비음화、유음화、경음화、구개음화、ㅎ탈락
3. 沒有發生音變的部分原樣保留；標點保留；分寫（띄어쓰기）維持原句的斷法
4. 只寫發音，不要附羅馬拼音、不要附說明`

  return `你是${input.language}教材編輯，服務對象為台灣的語言學習者。

以下是一段聽力稿，已經照原本順序切成 ${count} 句：
${numbered}

${rules}

共同要求：aids 陣列長度必須剛好 ${count}，順序跟原句一一對應，不可合併或拆開句子。

只輸出 JSON，不加任何前言、不用 markdown 圍欄：
{
  "aids": ["第一句", "第二句"]
}`
}
