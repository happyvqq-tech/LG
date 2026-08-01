// 日文假名標記的解析——純函式，方便單元測試
//
// AI 回傳的是 [漢字|かんじ] 這種行內標記（見 prompts/readingAid.ts），
// 這裡把它切成可以用 <ruby> 渲染的片段。
//
// 為什麼不叫 AI 直接輸出 HTML：那等於讓模型產生會被塞進畫面的標記，
// 一旦它多吐一個標籤就是 XSS 面。用自訂的純文字格式在這裡解析，
// 產出的永遠是安全的資料結構，React 照常做跳脫。

export interface RubySegment {
  /** 要顯示的本文 */
  text: string
  /** 標在上方的讀音；沒有讀音的片段為 undefined */
  ruby?: string
}

/**
 * 標記格式刻意用 [ | ]：
 * 日文正文裡幾乎不會出現半形方括號與豎線，用它們當分隔不會誤判，
 * 而《》在日文裡是書名號，拿來當標記會跟真的書名撞在一起。
 */
const RUBY_PATTERN = /\[([^[\]|]+)\|([^[\]|]+)\]/g

export function parseRuby(text: string): RubySegment[] {
  const segments: RubySegment[] = []
  let lastIndex = 0

  // exec 迴圈而不是 matchAll：需要 lastIndex 來取出標記之間的純文字
  RUBY_PATTERN.lastIndex = 0
  let match = RUBY_PATTERN.exec(text)
  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) })
    }
    segments.push({ text: match[1], ruby: match[2] })
    lastIndex = match.index + match[0].length
    match = RUBY_PATTERN.exec(text)
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) })
  }
  return segments
}

/** 把標記拿掉，還原成沒有讀音的原句（比對、複製、送去合成語音時用） */
export function stripRuby(text: string): string {
  return text.replace(RUBY_PATTERN, '$1')
}
