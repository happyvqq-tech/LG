// Prompt 模組登錄表：模組名 → system prompt 組裝函式 ＋ 模型 ＋ max_tokens
//
// 為什麼 prompt 在 Worker 而不在前端（這是 2026-08 才搬過來的）：
//
// 前端的 JS 一定會下載到訪客瀏覽器。prompt 放在前端時，任何人按 F12
// 搜一下關鍵字就能把全部 15 個模組的完整內容複製走——不用 clone repo、
// 不用讀原始碼。而這個專案真正花過腦子的就是 prompt 設計（三語各自的語塊
// 定義、錯誤曝光機制、泛聽要降一級、日韓讀音標註規則），React 元件反而是
// 通用零件。搬到這裡之後，瀏覽器只看得到模組名稱與變數。
//
// 附帶的好處有兩個，實務上可能比防抄更有感：
//   1. 改 prompt 只要 wrangler deploy（約 5 秒），不用重跑整個前端 build
//   2. 模型選擇也一併搬過來了——前端不再能指定 model，
//      避免有人直接對 /api/chat 送一個貴模型的名字
//
// 驗證函式（isTaskJson 等）刻意留在前端：那是解析回應用的，跟 prompt 是
// 不同性質的東西，也不是機密。

import { annotateSystemPrompt, type AnnotateInput } from './classicalTutor'
import { translationGraderSystemPrompt, type TranslationGradeInput } from './classicalTutor'
import { dialogPartnerSystemPrompt, type DialogPartnerInput } from './dialogPartner'
import { discussPartnerSystemPrompt, type DiscussPartnerInput } from './discussPartner'
import { extensiveSystemPrompt, type ExtensiveInput } from './extensive'
import { graderSystemPrompt } from './grader'
import { particleTutorSystemPrompt, type ParticleQuizInput } from './particleTutor'
import { quizGeneratorSystemPrompt, type QuizGenInput } from './quizGenerator'
import { readingAidSystemPrompt, type ReadingAidInput } from './readingAid'
import { reviewPracticeSystemPrompt, type ReviewPracticeInput } from './reviewPractice'
import { taigiScriptSystemPrompt, type TaigiScriptInput } from './taigiScript'
import { taskGeneratorSystemPrompt, type TaskGeneratorInput } from './taskGenerator'
import { translateSystemPrompt, type TranslateInput } from './translate'
import { vocabEnrichSystemPrompt, type VocabEnrichInput } from './vocabEnrich'
import { weeklyReportSystemPrompt, type WeeklyReportInput } from './weeklyReport'
import type { TaskLanguage } from './types'

/** 模型字串集中在這裡，CLAUDE.md 第 5 節是它的規格來源 */
const HAIKU = 'claude-haiku-4-5'
const SONNET = 'claude-sonnet-4-6'

export type PromptModule =
  | 'taskGenerator'
  | 'dialogPartner'
  | 'discussPartner'
  | 'grader'
  | 'weeklyReport'
  | 'taigiScript'
  | 'translate'
  | 'readingAid'
  | 'extensive'
  | 'quizGenerator'
  | 'vocabEnrich'
  | 'particleTutor'
  | 'reviewPractice'
  | 'classicalAnnotate'
  | 'classicalTranslationGrade'

interface PromptSpec {
  model: string
  maxTokens: number
  build: (vars: unknown) => string
}

/**
 * vars 是從瀏覽器送來的 JSON，型別上就是 unknown。
 *
 * 這裡直接斷言成各模組的輸入型別，不逐欄驗證——理由是它唯一的去處是
 * 字串模板：填進去的東西再怪也只會產生一份怪 prompt，不會有注入或越權。
 * 真正的關卡是通關密碼（hasAccess）與限流，不是這裡。
 */
function as<T>(vars: unknown): T {
  return vars as T
}

const REGISTRY: Record<PromptModule, PromptSpec> = {
  taskGenerator: {
    model: HAIKU,
    maxTokens: 3000,
    build: (v) => taskGeneratorSystemPrompt(as<TaskGeneratorInput>(v)),
  },
  dialogPartner: {
    model: HAIKU,
    maxTokens: 1024,
    build: (v) => dialogPartnerSystemPrompt(as<DialogPartnerInput>(v)),
  },
  discussPartner: {
    model: HAIKU,
    maxTokens: 1024,
    build: (v) => discussPartnerSystemPrompt(as<DiscussPartnerInput>(v)),
  },
  grader: {
    model: SONNET,
    maxTokens: 3000,
    // 這個模組的輸入就是一個語言字串，沒有 Input 介面
    build: (v) => graderSystemPrompt(as<TaskLanguage>(v)),
  },
  weeklyReport: {
    model: SONNET,
    maxTokens: 2000,
    build: (v) => weeklyReportSystemPrompt(as<WeeklyReportInput>(v)),
  },
  // 台語漢字用字與台羅拼音要正確，這比一般任務生成難，用能力較強的模型
  taigiScript: {
    model: SONNET,
    maxTokens: 3000,
    build: (v) => taigiScriptSystemPrompt(as<TaigiScriptInput>(v)),
  },
  translate: {
    model: SONNET,
    maxTokens: 1500,
    build: (v) => translateSystemPrompt(as<TranslateInput>(v)),
  },
  // 讀音標錯一個音比沒標更糟，正確性比速度值錢，所以用 Sonnet
  readingAid: {
    model: SONNET,
    maxTokens: 2000,
    build: (v) => readingAidSystemPrompt(as<ReadingAidInput>(v)),
  },
  extensive: {
    model: HAIKU,
    maxTokens: 3000,
    build: (v) => extensiveSystemPrompt(as<ExtensiveInput>(v)),
  },
  quizGenerator: {
    model: SONNET,
    maxTokens: 3000,
    build: (v) => quizGeneratorSystemPrompt(as<QuizGenInput>(v)),
  },
  vocabEnrich: {
    model: HAIKU,
    maxTokens: 3000,
    build: (v) => vocabEnrichSystemPrompt(as<VocabEnrichInput>(v)),
  },
  particleTutor: {
    model: SONNET,
    maxTokens: 2500,
    build: (v) => particleTutorSystemPrompt(as<ParticleQuizInput>(v)),
  },
  reviewPractice: {
    model: SONNET,
    maxTokens: 3000,
    build: (v) => reviewPracticeSystemPrompt(as<ReviewPracticeInput>(v)),
  },
  classicalAnnotate: {
    model: SONNET,
    maxTokens: 3000,
    build: (v) => annotateSystemPrompt(as<AnnotateInput>(v)),
  },
  classicalTranslationGrade: {
    model: SONNET,
    maxTokens: 3000,
    build: (v) => translationGraderSystemPrompt(as<TranslationGradeInput>(v)),
  },
}

export function isPromptModule(v: unknown): v is PromptModule {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(REGISTRY, v)
}

export interface ResolvedPrompt {
  model: string
  maxTokens: number
  system: string
}

/** 組出這次要送給 Anthropic 的 system prompt、模型與 token 上限 */
export function resolvePrompt(module: PromptModule, vars: unknown): ResolvedPrompt {
  const spec = REGISTRY[module]
  return { model: spec.model, maxTokens: spec.maxTokens, system: spec.build(vars) }
}
