// 對應 supabase/schema.sql 的資料型別與任務 JSON 結構

export type Language = '英文' | '日文' | '台語' | '古文'
export type Level = 'A2' | 'B1' | 'B2' | 'C1'
export type Scenario = '校園' | '日常' | '旅遊' | '職場' | '新聞時事' | '科技'

export const ALL_SCENARIOS: Scenario[] = ['校園', '日常', '旅遊', '職場', '新聞時事', '科技']
export const ALL_LEVELS: Level[] = ['A2', 'B1', 'B2', 'C1']

/** 各程度的白話說明（選擇程度時以浮動提示呈現） */
export const LEVEL_INFO: Record<Level, { label: string; desc: string }> = {
  A2: {
    label: '初級',
    desc: '能應付簡單日常需求：點餐、問路、自我介紹。聽得懂放慢語速的短句，會用基本時態造句。',
  },
  B1: {
    label: '中級',
    desc: '能聽懂日常對話的主要內容，旅遊購物自己來沒問題。文法還是會錯，但溝通不成問題。',
  },
  B2: {
    label: '中高級',
    desc: '能和母語者流暢對話不太卡，看得懂新聞文章，能寫出結構完整、論點清楚的短文。',
  },
  C1: {
    label: '高級',
    desc: '能理解長篇複雜文章與言外之意，表達流利自然、用字精準，接近母語者水平。',
  },
}

/** 每日學習計畫（可匯出 .ics 加進手機行事曆提醒） */
export interface DailyPlan {
  /** 24 小時制 'HH:MM' */
  time: string
  /** 每日目標分鐘數 */
  minutes: number
  /** 練習日：0=週日 … 6=週六 */
  days: number[]
}

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const

export interface Profile {
  id: string
  name: string
  languages: Language[]
  level: Level
  scenario_pool: Scenario[]
  /** 成員照片（壓縮後的 data URL；未設定為 null） */
  avatar_url: string | null
  daily_plan: DailyPlan | null
  vocab_pref: VocabPref | null
  /** 古文程度：入門／基礎／進階／高階（見 data/classicalIndex.ts） */
  classical_level: string | null
  created_at: string
}

export type TaskStatus = 'pending' | 'done'

export interface Chunk {
  text: string
  zh: string
  usage: string
  furigana?: string // 日文模式（第二階段）
}

/** 任務生成器輸出（CLAUDE.md 6.1）＋ 流程中累積的欄位 */
export interface TaskJson {
  scenario_title: string
  scenario_desc: string
  listening_script: string
  chunks: Chunk[]
  speaking_goal: string
  speaking_role_setup: string
  writing_prompt: string
  grammar_points_used: string[]
  // 流程中寫入
  speaking_transcript?: ChatMessage[]
  grading?: GraderResult
  writing_answer?: string
  /** 生成任務時埋設驗證的 pending_verify 錯誤 id */
  verify_error_ids?: string[]
  /** 本任務批改後寫入 errors 表的新錯誤 id（重新批改時據此清除重寫） */
  inserted_error_ids?: string[]
}

export interface Task {
  id: string
  profile_id: string
  language: Language
  task_json: TaskJson
  status: TaskStatus
  created_at: string
  completed_at: string | null
}

export type ErrorStatus = 'active' | 'pending_verify' | 'resolved'

export interface ErrorRecord {
  id: string
  profile_id: string
  language: Language
  original: string
  corrected: string
  error_type: string
  rule_note: string
  status: ErrorStatus
  verify_count: number
  created_at: string
}

export interface GrammarPoint {
  id: string
  language: Language
  name: string
  level: string
  description: string
  in_rotation: boolean
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** 批改回饋器輸出（CLAUDE.md 6.3） */
export interface DrillQuestion {
  q: string
  options: string[]
  answer: string
  explain: string
}

export interface GraderError {
  original: string
  corrected: string
  error_type: string
  rule_note: string
  drill: DrillQuestion[]
}

export interface GraderResult {
  minimal_fix: string
  native_version: string
  errors: GraderError[]
  praise: string
}

/** 單字卡（對應 vocab_cards 表） */
export interface VocabCard {
  id: string
  profile_id: string
  language: Language
  word: string
  /** 英文音標 / 日文假名 */
  reading: string
  meaning_zh: string
  pos: string
  example: string
  example_zh: string
  collocations: string[]
  exam: string
  exam_level: string
  /** list=內建字表 ai=AI 補充 task=任務生字 */
  source: 'list' | 'ai' | 'task'
  // SRS 狀態
  stage: number
  ease: number
  interval_days: number
  repetitions: number
  lapses: number
  due_date: string
  created_at: string
}

/** 古文學習進度（對應 classical_progress 表） */
export interface ClassicalProgress {
  id: string
  profile_id: string
  text_id: string
  /** 已讀到第幾段（0-based） */
  para_index: number
  /** 句讀最佳正確率 0-1 */
  punctuation_best: number
  /** 翻譯最佳分數 0-100 */
  translation_best: number
  status: 'reading' | 'done'
  created_at: string
  updated_at: string
}

/** 每日測驗的單題結果（存進 vocab_quizzes.details） */
export interface QuizDetail {
  word: string
  input: string
  verdict: 'correct' | 'inflected' | 'close' | 'wrong'
  used_hint: boolean
}

/** 一次測驗的成績（對應 vocab_quizzes 表） */
export interface QuizRecord {
  id: string
  profile_id: string
  language: Language
  quiz_date: string
  score: number
  total: number
  details: QuizDetail[]
  created_at: string
}

/** 成員的單字學習設定（存 profiles.vocab_pref） */
export interface VocabPref {
  exam: string
  exam_level: string
  /** 每日新字量 */
  daily_new: number
}

export const DEFAULT_VOCAB_PREF: VocabPref = { exam: 'TOEIC', exam_level: '650', daily_new: 10 }

/** 虛詞卡（對應 particle_cards 表，間隔重複排程同 srs.ts） */
export interface ParticleCard {
  id: string
  profile_id: string
  language: Language
  word: string
  stage: number
  ease: number
  interval_days: number
  repetitions: number
  lapses: number
  due_date: string
  created_at: string
}

/** 每日活動紀錄（對應 activity_log 表，用於計算連續天數） */
export interface ActivityLogRow {
  id: string
  profile_id: string
  activity_date: string
}

export interface TaiwaneseScriptLine {
  hanji: string
  tailo: string
  mandarin: string
}

export interface TaiwaneseScript {
  id: string
  title: string
  lines: TaiwaneseScriptLine[]
  audio_urls: Record<string, string>
  created_at: string
}
