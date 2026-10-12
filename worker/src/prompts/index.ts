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
import { songLessonSystemPrompt, type SongLessonInput } from './songLesson'
import { songPickerSystemPrompt, type SongPickerInput } from './songPicker'
import { videoLessonSystemPrompt, type VideoLessonInput } from './videoLesson'
import { articleLessonSystemPrompt, type ArticleLessonInput } from './articleLesson'
import { articlePickerSystemPrompt, type ArticlePickerInput } from './articlePicker'
import { videoPickerSystemPrompt, type VideoPickerInput } from './videoPicker'
import { taigiScriptSystemPrompt, type TaigiScriptInput } from './taigiScript'
import { taskGeneratorSystemPrompt, type TaskGeneratorInput } from './taskGenerator'
import { translateSystemPrompt, type TranslateInput } from './translate'
import { vocabEnrichSystemPrompt, type VocabEnrichInput } from './vocabEnrich'
import { weeklyReportSystemPrompt, type WeeklyReportInput } from './weeklyReport'
import type { TaskLanguage } from './types'

/**
 * 模型字串集中在這裡，CLAUDE.md 第 5 節是它的規格來源。
 *
 * 2026-10 使用者同意從 Sonnet 4.6／Haiku 4.5 換成 Sonnet 5.5／Haiku 5.5：
 * 單價較低（Sonnet $2/$10 vs $3/$15；Haiku $0.10/$0.50 vs $1/$5，每百萬 token），
 * 但新一代的 tokenizer 同樣文字約多 30% token——所以下面每個 maxTokens 都同步
 * 放大約三成，否則同樣長度的教材會被截斷成半份 JSON，觸發重試、費用加倍。
 */
const HAIKU = 'claude-haiku-5-5'
const SONNET = 'claude-sonnet-5-5'

/**
 * 每個模型都必須附帶的請求設定。
 *
 * 新一代模型**預設會先思考**（舊一代預設不會），思考的 token 照輸出計價、
 * 而且算進 maxTokens。這裡的模組都是「一次產出一份 JSON」，以前也從來沒思考過，
 * 放著不管的話思考會吃掉額度、把 JSON 擠到截斷，手機上也更容易逾時。
 * 所以明確關掉，維持跟換模型之前一樣的行為：
 *   - Sonnet 5.5 不接受 disabled，關掉思考要用 between_tools（只能配 effort high 以下）
 *   - Haiku 5.5 接受 disabled（effort high 以下）
 * effort 照各自的預設值寫明：Sonnet 是 high、Haiku 是 medium。不寫的話以後預設值
 * 一改，行為就會在沒人動程式的情況下變掉。
 *
 * Sonnet 另外開了伺服器端 fallback：新模型的安全分類器偶爾會拒答
 * （這個 App 的內容幾乎不可能觸發），被拒時由 API 自動改用 Sonnet 5 重跑，
 * 不用前端再處理。Haiku 5.5 沒有伺服器端 fallback，送了反而會 400。
 */
export interface ModelRequestOptions {
  /** 併進送給 Anthropic 的 request body */
  body: Record<string, unknown>
  /** anthropic-beta 標頭 */
  betas: string[]
}

export function requestOptionsFor(model: string): ModelRequestOptions {
  if (model === SONNET) {
    return {
      body: {
        thinking: { type: 'between_tools' },
        output_config: { effort: 'high' },
        fallbacks: 'default',
      },
      betas: ['server-side-fallback-2026-07-01'],
    }
  }
  if (model === HAIKU) {
    return {
      body: { thinking: { type: 'disabled' }, output_config: { effort: 'medium' } },
      betas: [],
    }
  }
  // 舊版前端自己指定模型的路徑（見 worker/src/index.ts 的 ChatRequestBody）：
  // 那些是舊模型，照舊送，不加任何新欄位
  return { body: {}, betas: [] }
}

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
  | 'songPicker'
  | 'songLesson'
  | 'videoPicker'
  | 'videoLesson'
  | 'articleLesson'
  | 'articlePicker'

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
  // 教材是給人反覆聽讀的成品，連貫性比生成速度值錢。Haiku 會逐條滿足
  // 硬性要求（文法點×3、單字帶入、錯誤埋設）卻犧牲句間銜接，成品前後不順；
  // 生成一天只跑一次，用 Sonnet 的成本差可忽略
  taskGenerator: {
    model: SONNET,
    maxTokens: 4000,
    build: (v) => taskGeneratorSystemPrompt(as<TaskGeneratorInput>(v)),
  },
  dialogPartner: {
    model: HAIKU,
    maxTokens: 1400,
    build: (v) => dialogPartnerSystemPrompt(as<DialogPartnerInput>(v)),
  },
  discussPartner: {
    model: HAIKU,
    maxTokens: 1400,
    build: (v) => discussPartnerSystemPrompt(as<DiscussPartnerInput>(v)),
  },
  grader: {
    model: SONNET,
    maxTokens: 4000,
    // 這個模組的輸入就是一個語言字串，沒有 Input 介面
    build: (v) => graderSystemPrompt(as<TaskLanguage>(v)),
  },
  weeklyReport: {
    model: SONNET,
    maxTokens: 2700,
    build: (v) => weeklyReportSystemPrompt(as<WeeklyReportInput>(v)),
  },
  // 台語漢字用字與台羅拼音要正確，這比一般任務生成難，用能力較強的模型
  taigiScript: {
    model: SONNET,
    maxTokens: 4000,
    build: (v) => taigiScriptSystemPrompt(as<TaigiScriptInput>(v)),
  },
  // 逐句翻譯是機械性工作（句數要對齊，格式固定），Haiku 5.5 的指令遵循足以勝任，
  // 價格約是 Sonnet 的二十分之一
  translate: {
    model: HAIKU,
    maxTokens: 2000,
    build: (v) => translateSystemPrompt(as<TranslateInput>(v)),
  },
  // 讀音標錯一個音比沒標更糟，正確性比速度值錢，所以用 Sonnet
  readingAid: {
    model: SONNET,
    maxTokens: 2700,
    build: (v) => readingAidSystemPrompt(as<ReadingAidInput>(v)),
  },
  // 600-900 字長文比短稿更吃連貫性（泛聽要「聽得下去」），同樣改用 Sonnet
  extensive: {
    model: SONNET,
    maxTokens: 4000,
    build: (v) => extensiveSystemPrompt(as<ExtensiveInput>(v)),
  },
  // 從既有單字卡出選擇題：題幹與正解都來自卡片，模型只負責排版與編誘答選項
  quizGenerator: {
    model: HAIKU,
    maxTokens: 4000,
    build: (v) => quizGeneratorSystemPrompt(as<QuizGenInput>(v)),
  },
  vocabEnrich: {
    model: HAIKU,
    maxTokens: 4000,
    build: (v) => vocabEnrichSystemPrompt(as<VocabEnrichInput>(v)),
  },
  particleTutor: {
    model: SONNET,
    maxTokens: 3400,
    build: (v) => particleTutorSystemPrompt(as<ParticleQuizInput>(v)),
  },
  reviewPractice: {
    model: SONNET,
    maxTokens: 4000,
    build: (v) => reviewPracticeSystemPrompt(as<ReviewPracticeInput>(v)),
  },
  classicalAnnotate: {
    model: SONNET,
    maxTokens: 4000,
    build: (v) => annotateSystemPrompt(as<AnnotateInput>(v)),
  },
  classicalTranslationGrade: {
    model: SONNET,
    maxTokens: 4000,
    build: (v) => translationGraderSystemPrompt(as<TranslationGradeInput>(v)),
  },
  // 選歌要真的知道哪些歌存在、哪些紅——Haiku 杜撰歌名的機率明顯高很多
  songPicker: {
    model: SONNET,
    maxTokens: 2700,
    build: (v) => songPickerSystemPrompt(as<SongPickerInput>(v)),
  },
  // 逐行判斷「這句能不能拿去用」是這個模組唯一的價值，判錯就整份教材失去意義。
  // 輸出是每行四個欄位，所以比其他模組寬一些；但也不能太寬——整份教材是一次
  // 請求產出的，輸出逼近三千 token 時要跑快一分鐘，期間連線上毫無回應，
  // 手機瀏覽器會直接斷線（實測就是這樣壞的）。段數上限在 prompt 裡一起收斂了
  songLesson: {
    model: SONNET,
    maxTokens: 3400,
    build: (v) => songLessonSystemPrompt(as<SongLessonInput>(v)),
  },
  // 選片方向要判斷「什麼素材在這個程度聽得下去」，而且要避開幻想出不存在的頻道
  videoPicker: {
    model: SONNET,
    maxTokens: 2700,
    build: (v) => videoPickerSystemPrompt(as<VideoPickerInput>(v)),
  },
  // 判斷「這句用耳朵聽會不會跟字面差很遠」是這個模組的全部價值。
  // token 上限跟歌曲教材一樣收在 2500——整份一次產出，太大會在手機上逾時
  videoLesson: {
    model: SONNET,
    maxTokens: 3400,
    build: (v) => videoLessonSystemPrompt(as<VideoLessonInput>(v)),
  },
  // 長句解剖是這個模組的核心價值，而拆一句三層子句要把原文整句抄回來，
  // 所以上限比影片寬一點；但仍然是一次產出，不能給到沒有邊
  articleLesson: {
    model: SONNET,
    maxTokens: 4000,
    build: (v) => articleLessonSystemPrompt(as<ArticleLessonInput>(v)),
  },
  // 從真實清單裡挑、用索引回答。挑錯了只是推薦不準，不會教錯東西
  //（索引在前端驗證過，不可能推薦出不存在的文章），所以用 Haiku 5.5
  articlePicker: {
    model: HAIKU,
    maxTokens: 2700,
    build: (v) => articlePickerSystemPrompt(as<ArticlePickerInput>(v)),
  },
}

export function isPromptModule(v: unknown): v is PromptModule {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(REGISTRY, v)
}

export interface ResolvedPrompt {
  model: string
  maxTokens: number
  system: string
  options: ModelRequestOptions
}

/** 組出這次要送給 Anthropic 的 system prompt、模型與 token 上限 */
export function resolvePrompt(module: PromptModule, vars: unknown): ResolvedPrompt {
  const spec = REGISTRY[module]
  return {
    model: spec.model,
    maxTokens: spec.maxTokens,
    system: spec.build(vars),
    options: requestOptionsFor(spec.model),
  }
}
