// 泛聽教材生成
//
// 泛聽（extensive listening）跟精聽是兩件事，不該互相取代：
//   精聽建立準確度——每個字都要聽懂，文法點要抓出來（＝現在的每日任務）
//   泛聽建立自動化與語感——不查字典、不倒帶、聽個大概就好
// 只有精聽的學習者會變成「每句都要想」：文法很好、考試很好，但講話卡。
//
// 為什麼要另外開一條通道：每日任務的聽力稿 150-250 字，一週約 1,500 字。
// 要靠隱性學習習得一個詞需要 10-20 次遭遇（Nation、Webb），這個量級做不到。
//
// 最違反直覺、也最關鍵的一點：**泛聽的難度要低於學習者的程度**。
// 泛聽要的是 98% 的詞都認得，讀起來不費力才聽得下去、也才累積得了量。
// 用學習程度去生成泛聽材料，會得到一份「需要專心解碼」的東西，那又變回精聽了。

import type { Level, TaskLanguage } from '../types'

/** 泛聽用的程度：一律比學習程度低一級（A2 已經最低，維持不變） */
export function extensiveLevel(level: Level): Level {
  const down: Record<Level, Level> = { C1: 'B2', B2: 'B1', B1: 'A2', A2: 'A2' }
  return down[level]
}

export interface ExtensiveInput {
  language: TaskLanguage
  /** 已經降過一級的程度，用 extensiveLevel() 取得 */
  level: Level
  topic: string
}

export interface ExtensiveResult {
  title: string
  script: string
}

/** 長度下限設 300 是防「AI 只寫兩段就交差」——那樣就失去泛聽的意義了 */
export function isExtensiveResult(v: unknown): v is ExtensiveResult {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (typeof o.title !== 'string' || o.title.trim() === '') return false
  if (typeof o.script !== 'string' || o.script.trim().length < 300) return false
  return true
}
