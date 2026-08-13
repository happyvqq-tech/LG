// 「今天只有 5 分鐘」的資料層
//
// 三種素材全部來自既有的表，沒有一項需要生成：到期單字、錯誤庫的舊錯、
// 舊教材的句子。所以這個模式不呼叫 AI，開啟速度只受資料庫查詢限制。

import { supabase } from './supabase'
import { getDueCards } from './vocabService'
import { listPastTasks } from './taskService'
import { pickReviewTasks } from './reviewSchedule'
import { splitSentences } from './speech'
import { examLanguage, type ExamSystem } from '../data/vocabLists'
import { buildQuickPlan, type ListenSentence, type QuickPlan } from './quickRules'
import { DEFAULT_VOCAB_PREF, isTaskLanguage, type ErrorRecord, type Profile } from './types'

/** 一次撈幾筆就夠 buildQuickPlan 挑：多撈只是浪費頻寬 */
const FETCH = { vocab: 10, errors: 6, listenSentences: 4 }

/**
 * 錯誤庫裡最舊的未解決錯誤。
 * 挑最舊的而不是最新的：新錯誤剛批改完還記得，最舊的那些才是真的快忘光、
 * 而且卡在 active 最久沒有進展的。
 */
async function fetchOldErrors(profileId: string): Promise<ErrorRecord[]> {
  const { data, error } = await supabase
    .from('errors')
    .select('*')
    .eq('profile_id', profileId)
    .in('status', ['active', 'pending_verify'])
    .order('created_at')
    .limit(FETCH.errors)
  if (error) throw new Error(error.message)
  return (data ?? []) as ErrorRecord[]
}

/** 今天該重聽的舊教材，取前幾句。整篇太長，五分鐘模式只取開頭幾句 */
async function fetchListenSentences(profileId: string, now: Date): Promise<ListenSentence[]> {
  const tasks = await listPastTasks(profileId, null)
  const picks = pickReviewTasks(tasks.filter((t) => isTaskLanguage(t.language)), now)
  if (picks.length === 0) return []

  const { task, label } = picks[0]
  return splitSentences(task.task_json.listening_script)
    .slice(0, FETCH.listenSentences)
    .map((sentence) => ({
      taskId: task.id,
      title: `${label}・${task.task_json.scenario_title}`,
      sentence,
      language: task.language,
    }))
}

/**
 * 排出這次的五分鐘。任何一種素材讀失敗都只是少一種，不讓整頁失敗——
 * 這個入口存在的理由就是「忙的時候也能做一點」，它自己不能是個障礙。
 */
export async function loadQuickPlan(profile: Profile, now = new Date()): Promise<QuickPlan> {
  const pref = profile.vocab_pref ?? DEFAULT_VOCAB_PREF
  const vocabLanguage = examLanguage(pref.exam as ExamSystem)

  const [vocab, errors, listen] = await Promise.all([
    getDueCards(profile.id, vocabLanguage, FETCH.vocab).catch(() => []),
    fetchOldErrors(profile.id).catch(() => []),
    fetchListenSentences(profile.id, now).catch(() => []),
  ])

  return buildQuickPlan({ vocab, errors, listen })
}
