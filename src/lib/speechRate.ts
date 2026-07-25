// 朗讀速度：全 app 共用的偏好設定
//
// 存在 localStorage 並以成員區分——小孩和大人共用同一台裝置，
// 需要的語速差很多，不該互相蓋掉。

export type SpeedLevel = '慢' | '正常' | '快' | '很快' | '極快'

export const SPEED_LEVELS: SpeedLevel[] = ['慢', '正常', '快', '很快', '極快']

/**
 * speechSynthesis 的 rate 值。
 * 2.0 以上多數語音會開始糊掉，故極快設在 2.0。
 */
export const SPEED_RATE: Record<SpeedLevel, number> = {
  慢: 0.6,
  正常: 1,
  快: 1.3,
  很快: 1.6,
  極快: 2,
}

export const SPEED_HINT: Record<SpeedLevel, string> = {
  慢: '逐字聽清楚，適合第一次接觸或跟讀',
  正常: '母語者的一般語速',
  快: '新聞播報的速度',
  很快: '練習聽力反應速度',
  極快: '極限訓練，聽得懂這個速度就穩了',
}

export const DEFAULT_SPEED: SpeedLevel = '正常'

const KEY_PREFIX = 'lgl.speechRate'

function keyFor(profileId?: string): string {
  return profileId ? `${KEY_PREFIX}.${profileId}` : KEY_PREFIX
}

export function loadSpeed(profileId?: string): SpeedLevel {
  try {
    const v = localStorage.getItem(keyFor(profileId))
    if (v && (SPEED_LEVELS as string[]).includes(v)) return v as SpeedLevel
  } catch {
    // localStorage 不可用（無痕模式等）時退回預設值
  }
  return DEFAULT_SPEED
}

export function saveSpeed(level: SpeedLevel, profileId?: string): void {
  try {
    localStorage.setItem(keyFor(profileId), level)
  } catch {
    // 存不起來就只在本次有效，不影響使用
  }
}
