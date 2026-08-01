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

import type { Language, TaskLanguage } from '../types'

/** 日文假名標記格式：漢字詞用 [漢字|かんじ] 包起來 */
export const RUBY_OPEN = '['
export const RUBY_SEP = '|'
export const RUBY_CLOSE = ']'

/** 這個語言有沒有讀音輔助可用（UI 據此決定要不要顯示按鈕） */
export function readingAidSupported(language: Language): language is '日文' | '韓文' {
  return language === '日文' || language === '韓文'
}

/** 按鈕文案，兩個語言要標的東西不同，不能共用一個說法 */
export const READING_AID_LABEL: Record<'日文' | '韓文', { show: string; hide: string }> = {
  日文: { show: '顯示假名', hide: '隱藏假名' },
  韓文: { show: '顯示實際發音', hide: '隱藏實際發音' },
}

export interface ReadingAidInput {
  language: TaskLanguage
  sentences: string[]
}

export interface ReadingAidResult {
  aids: string[]
}

/** 驗證要知道預期句數，才能擋住「少標一句/多標一句」這種結構對得上但內容對不齊的情況 */
export function makeIsReadingAidResult(expectedCount: number) {
  return (v: unknown): v is ReadingAidResult => {
    if (typeof v !== 'object' || v === null) return false
    const o = v as Record<string, unknown>
    if (!Array.isArray(o.aids)) return false
    if (o.aids.length !== expectedCount) return false
    return o.aids.every((a) => typeof a === 'string' && a.trim() !== '')
  }
}
