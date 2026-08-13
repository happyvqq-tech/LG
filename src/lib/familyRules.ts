// 全家一週摘要的純邏輯——不依賴 Supabase，可獨立測試
//
// 為什麼值得做：這個 App 有一個外面產品花錢也買不到的東西——內建的真實社交圈。
// 2-4 個家人本來就互相認識、每天見面。互相看得見的連續天數會產生一種
// 外部 App 做不到的同儕壓力，而且不是演算法推播的壓力，是「晚餐時會被問起」的壓力。
//
// 但有一條線不能越過：這是家人，不是排行榜上的陌生人。
// 所以這裡只講好事——誰最勤、誰攻克了什麼、誰進步最多，
// 不做「誰最混」的反向排名，也不顯示每個人的完整名次。
// 讓落後的人自己看到自己的格子是空的就夠了，不需要系統再補一刀。
//
// 摘要完全由規則產生，不呼叫 AI：內容本質上就是「四個人的數字取最大值」，
// 用 AI 生成只是多花錢、多一個會失敗的環節，還可能講出跟數字不符的話。
// 語氣的變化改用「依週次輪替模板」達成——同一週內穩定，跨週會換句話講。

export interface MemberWeek {
  profileId: string
  name: string
  /** 目前連續天數 */
  streak: number
  /** 最近 7 天的練習天數（0-7） */
  practiceDays: number
  /** 最近 7 天攻克的長期錯誤數 */
  resolved: number
  /** 最近 7 天新學的單字數 */
  newVocab: number
  /** 最近 7 天，索引 0=6 天前…6=今天 */
  last7: boolean[]
}

export interface DigestLine {
  emoji: string
  text: string
}

/** 以「今年第幾週」當模板輪替的種子。不用 Math.random：同一週重整畫面要講一樣的話 */
export function weekSeed(now: Date): number {
  const start = new Date(now.getFullYear(), 0, 1)
  return Math.floor((now.getTime() - start.getTime()) / (7 * 86400000))
}

/** 並列第一時把名字串起來：「小明和小華」「小明、小華和阿姨」 */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join('、')}和${names[names.length - 1]}`
}

/** 取某個欄位的並列最大值；全部是 0 就回 null（沒有值得說的事） */
function leaders(members: MemberWeek[], pick: (m: MemberWeek) => number): { names: string[]; value: number } | null {
  const max = Math.max(0, ...members.map(pick))
  if (max <= 0) return null
  return { names: members.filter((m) => pick(m) === max).map((m) => m.name), value: max }
}

const DILIGENT_TEMPLATES = [
  (who: string, n: number) => `${who} 這週練了 ${n} 天，全家最多`,
  (who: string, n: number) => `本週最勤是 ${who}，練了 ${n} 天`,
  (who: string, n: number) => `${who} 這週出席 ${n} 天，領先全家`,
]

/** 讓給別人講的時候用這組：不能說「全家最多」，那個人不是第一名 */
const DILIGENT_PLAIN_TEMPLATES = [
  (who: string, n: number) => `${who} 這週也練了 ${n} 天`,
  (who: string, n: number) => `${who} 這週出席 ${n} 天`,
  (who: string, n: number) => `${who} 這週練了 ${n} 天`,
]

const STREAK_TEMPLATES = [
  (who: string, n: number) => `${who} 連續 ${n} 天沒斷過`,
  (who: string, n: number) => `${who} 的連續紀錄來到 ${n} 天`,
  (who: string, n: number) => `${who} 已經連續 ${n} 天了`,
]

const VOCAB_TEMPLATES = [
  (who: string, n: number) => `${who} 這週新學了 ${n} 個單字`,
  (who: string, n: number) => `${who} 的單字庫這週多了 ${n} 個`,
  (who: string, n: number) => `${who} 這週吃下 ${n} 個新單字`,
]

/**
 * 產生全家一週摘要，最多 4 行。
 *
 * 排序原則跟任務結算一樣：最難的事排最前面。攻克長期錯誤 >> 連續天數 >>
 * 練習天數 >> 單字量——後面兩個只要有時間就做得到，前面兩個做不了假。
 */
export function buildDigest(members: MemberWeek[], seed: number): DigestLine[] {
  if (members.length === 0) return []

  const totalDays = members.reduce((s, m) => s + m.practiceDays, 0)
  if (totalDays === 0) {
    return [{ emoji: '🌱', text: '這週全家都還沒開始——誰要按下第一個任務？' }]
  }

  const lines: DigestLine[] = []

  /**
   * 已經被點過名的人。有這個東西是因為第一版做出來四行全在講同一個人——
   * 表現最好的那個會橫掃所有欄位，其他三個人完全沒被提到。
   * 那正好是最該避免的排行榜感：家人不是來比名次的，摘要的價值在於
   * 「每個人都被看見」，不是「誰第一」。
   */
  const named = new Set<string>()

  /**
   * 挑一個還沒被點過名的人來講這個項目。
   * 真正的第一名已經講過了，就退而取「還沒被提到的人裡面最高的那個」，
   * 並回報 isLeader=false 讓呼叫端換一句不宣稱第一名的話——
   * 為了讓大家都有戲份而說謊，會讓整個摘要失去可信度。
   */
  function pickFresh(
    metric: (m: MemberWeek) => number,
  ): { names: string[]; value: number; isLeader: boolean } | null {
    const top = leaders(members, metric)
    if (!top) return null

    const fresh = top.names.filter((n) => !named.has(n))
    if (fresh.length > 0) return { names: fresh, value: top.value, isLeader: true }

    const rest = members.filter((m) => !named.has(m.name))
    const second = leaders(rest, metric)
    return second ? { ...second, isLeader: false } : null
  }

  function claim(names: string[]) {
    for (const n of names) named.add(n)
  }

  // 攻克長期錯誤：最難的事，有人做到就排第一
  const resolved = leaders(members, (m) => m.resolved)
  if (resolved) {
    const total = members.reduce((s, m) => s + m.resolved, 0)
    lines.push({
      emoji: '🎯',
      text:
        total > resolved.value
          ? `全家這週攻克了 ${total} 個長期錯誤，${joinNames(resolved.names)}最多（${resolved.value} 個）`
          : `${joinNames(resolved.names)} 攻克了 ${resolved.value} 個長期錯誤`,
    })
    claim(resolved.names)
  }

  // 連續天數：3 天以下還稱不上「紀錄」，講出來反而尷尬
  const streak = pickFresh((m) => m.streak)
  if (streak && streak.value >= 3) {
    lines.push({
      emoji: '🔥',
      text: STREAK_TEMPLATES[seed % STREAK_TEMPLATES.length](joinNames(streak.names), streak.value),
    })
    claim(streak.names)
  }

  const diligent = pickFresh((m) => m.practiceDays)
  // 只有一個人有練的時候，「全家最多」這種話很怪，這行就跳過
  if (diligent && members.filter((m) => m.practiceDays > 0).length > 1) {
    const templates = diligent.isLeader ? DILIGENT_TEMPLATES : DILIGENT_PLAIN_TEMPLATES
    lines.push({ emoji: '💪', text: templates[seed % templates.length](joinNames(diligent.names), diligent.value) })
    claim(diligent.names)
  }

  const vocab = pickFresh((m) => m.newVocab)
  if (vocab && lines.length < 4) {
    lines.push({ emoji: '📚', text: VOCAB_TEMPLATES[seed % VOCAB_TEMPLATES.length](joinNames(vocab.names), vocab.value) })
    claim(vocab.names)
  }

  // 一行都湊不出來（有人練了但沒攻克、沒連續、只有一個人在練、也沒學單字）
  if (lines.length === 0) {
    lines.push({ emoji: '👍', text: `全家這週一共練了 ${totalDays} 天` })
  }

  return lines.slice(0, 4)
}

/** 排序：連續天數多的在前，其次本週練習天數；都一樣就照名字，讓順序穩定 */
export function sortMembers(members: MemberWeek[]): MemberWeek[] {
  return [...members].sort(
    (a, b) => b.streak - a.streak || b.practiceDays - a.practiceDays || a.name.localeCompare(b.name),
  )
}
