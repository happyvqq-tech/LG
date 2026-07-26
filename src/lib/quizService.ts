// 每日測驗：選題、出題、記錄成績、把答錯的字餵回間隔重複
import { supabase } from './supabase'
import { callClaudeJSON } from './claude'
import {
  isQuizGenResult,
  quizGeneratorSystemPrompt,
  sanitizeSentence,
  type QuizGenResult,
} from './prompts/quizGenerator'
import { judgeAnswer, scoreFor, type Verdict } from './quizGrading'
import { nextDueDate, schedule, toDateString, MAX_STAGE } from './srs'
import { asTaskLanguage } from './types'
import type { Language, QuizDetail, QuizRecord, VocabCard } from './types'

export const QUIZ_SIZE = 10
/** 至少要有這麼多可測的字才開得成測驗 */
export const QUIZ_MIN_WORDS = 4
/** 已學會的字佔的抽查名額 */
const MASTERED_SLOTS = 2

export interface QuizQuestion {
  card: VocabCard
  sentence: string
  sentenceZh: string
  hint: string
  /**
   * 真正要核對的答案：日韓是句子裡活用/敬語變化後的形式，其他語言等於 card.word。
   * 之前直接拿 card.word（辭書形/기본형）去核對，日韓文法正確的活用形答案
   * 會被判「答錯」，還連帶把 SRS 排程當成真的忘記了（見複盤報告）。
   */
  answerSurface: string
}

function shuffle<T>(list: T[]): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

/**
 * 挑出要測的字：已過認詞關（stage >= 2）才有資格被測。
 * 主體取學習中的字，另留兩個名額給已學會的字做抽查，
 * 避免「學會」之後就再也不被檢查、悄悄忘掉。
 */
export async function pickQuizCards(
  profileId: string,
  language: Language,
  size = QUIZ_SIZE,
): Promise<VocabCard[]> {
  const { data, error } = await supabase
    .from('vocab_cards')
    .select('*')
    .eq('profile_id', profileId)
    .eq('language', language)
    .gte('stage', 2)
  if (error) throw new Error(error.message)

  const all = (data ?? []) as VocabCard[]
  const learning = all.filter((c) => c.stage < MAX_STAGE)
  const mastered = all.filter((c) => c.stage >= MAX_STAGE)

  // 忘記過的、快到期的優先測
  const priority = (c: VocabCard) => c.lapses * 10 - new Date(c.due_date).getTime() / 8.64e10
  const byPriority = (list: VocabCard[]) =>
    shuffle(list).sort((a, b) => priority(b) - priority(a))

  const masteredPick = byPriority(mastered).slice(0, MASTERED_SLOTS)
  const learningPick = byPriority(learning).slice(0, size - masteredPick.length)
  // 學習中的不夠時，用已學會的補滿
  const filler = byPriority(mastered.filter((c) => !masteredPick.includes(c))).slice(
    0,
    size - masteredPick.length - learningPick.length,
  )

  return shuffle([...learningPick, ...masteredPick, ...filler])
}

/** 請 AI 針對這批字出全新情境的填空題 */
export async function generateQuiz(
  cards: VocabCard[],
  exam: string,
  examLevel: string,
  language: Language,
): Promise<QuizQuestion[]> {
  const result = await callClaudeJSON<QuizGenResult>(
    {
      module: 'grader',
      system: quizGeneratorSystemPrompt({
        language: asTaskLanguage(language),
        exam,
        examLevel,
        cards,
      }),
      messages: [{ role: 'user', content: '請出題' }],
      maxTokens: 3000,
    },
    isQuizGenResult,
  )

  const byWord = new Map(cards.map((c) => [c.word.toLowerCase(), c]))
  const used = new Set<string>()
  const questions: QuizQuestion[] = []

  for (const q of result.questions) {
    const key = String(q.word ?? '').toLowerCase()
    const card = byWord.get(key)
    if (!card || used.has(key)) continue
    const answerSurface = String(q.answer_surface ?? '').trim() || card.word
    const sentence = sanitizeSentence(q.sentence, card.word, answerSurface)
    if (!sentence) continue // 出壞的題目直接丟掉，不讓使用者遇到
    used.add(key)
    questions.push({
      card,
      sentence,
      sentenceZh: String(q.sentence_zh ?? ''),
      hint: String(q.hint ?? ''),
      answerSurface,
    })
  }

  return questions
}

export interface GradedAnswer {
  question: QuizQuestion
  input: string
  verdict: Verdict
  usedHint: boolean
  score: number
}

export function gradeAnswer(
  question: QuizQuestion,
  input: string,
  usedHint: boolean,
): GradedAnswer {
  // 跟 answerSurface（句子裡實際要填的活用形）核對，不是跟辭書形/기본형核對——
  // 兩者常常是不同的字串，日韓文法正確的作答才不會被誤判答錯
  const verdict = judgeAnswer(input, question.answerSurface, question.card.reading)
  return { question, input, verdict, usedHint, score: scoreFor(verdict, usedHint) }
}

/**
 * 收尾：存成績，並把答錯的字排到明天複習。
 * 答對不動排程——測驗是檢測，不該拿來衝進度（否則間隔重複的節奏會被打亂）。
 */
export async function submitQuiz(
  profileId: string,
  language: Language,
  answers: GradedAnswer[],
): Promise<QuizRecord> {
  const wrong = answers.filter((a) => a.verdict === 'wrong')

  await Promise.all(
    wrong.map((a) => {
      const c = a.question.card
      const next = schedule(
        {
          stage: c.stage,
          ease: c.ease,
          intervalDays: c.interval_days,
          repetitions: c.repetitions,
          lapses: c.lapses,
        },
        'again',
      )
      return supabase
        .from('vocab_cards')
        .update({
          stage: next.stage,
          ease: next.ease,
          interval_days: next.intervalDays,
          repetitions: next.repetitions,
          lapses: next.lapses,
          due_date: nextDueDate(next),
        })
        .eq('id', c.id)
    }),
  )

  const details: QuizDetail[] = answers.map((a) => ({
    word: a.question.card.word,
    input: a.input,
    verdict: a.verdict,
    used_hint: a.usedHint,
  }))

  const row = {
    profile_id: profileId,
    language,
    quiz_date: toDateString(new Date()),
    score: answers.reduce((sum, a) => sum + a.score, 0),
    total: answers.length,
    details,
  }

  const { data, error } = await supabase.from('vocab_quizzes').insert(row).select().single()
  if (error) throw new Error(error.message)
  return data as QuizRecord
}

/** 最近幾次成績（新到舊），首頁畫趨勢用 */
export async function getQuizHistory(
  profileId: string,
  language: Language,
  limit = 10,
): Promise<QuizRecord[]> {
  const { data, error } = await supabase
    .from('vocab_quizzes')
    .select('*')
    .eq('profile_id', profileId)
    .eq('language', language)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []) as QuizRecord[]
}

/** 今天是否已測過（用來顯示「今天已完成」而不是擋住重測） */
export function takenToday(history: QuizRecord[]): QuizRecord | null {
  const today = toDateString(new Date())
  return history.find((h) => h.quiz_date === today) ?? null
}
