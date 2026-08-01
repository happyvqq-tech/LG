// 討論文章重點：AI 針對本次聽力稿的內容提問、追問，引導使用者用目標語言
// 把重點講出來。跟 dialogPartner（CLAUDE.md 6.2 的情境角色扮演）不同——
// 那個是演一個角色跟你拉鋸，這個是就文章內容討論，練的是「講得出重點」。

import type { ChatMessage, TaskLanguage } from '../types'

export interface DiscussPartnerInput {
  language: TaskLanguage
  scenarioTitle: string
  passage: string
}

/** AI 先開口的引導訊息（不顯示於畫面，只作為 API 對話的第一個 user turn） */
export const DISCUSS_BOOTSTRAP: ChatMessage = {
  role: 'user',
  content: '（系統）討論開始，請先用一句話開場，並問第一個關於文章大意的問題。',
}
