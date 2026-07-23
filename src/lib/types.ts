// 對應 supabase/schema.sql 的資料型別與任務 JSON 結構

export type Language = '英文' | '日文' | '台語'
export type Level = 'B1' | 'B2' | 'C1'
export type Scenario = '校園' | '日常' | '旅遊' | '職場' | '新聞時事' | '科技'

export const ALL_SCENARIOS: Scenario[] = ['校園', '日常', '旅遊', '職場', '新聞時事', '科技']
export const ALL_LEVELS: Level[] = ['B1', 'B2', 'C1']

export interface Profile {
  id: string
  name: string
  languages: Language[]
  level: Level
  scenario_pool: Scenario[]
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
