import { useCallback, useState } from 'react'
import { useProfile } from './profileContext'
import { loadSpeed, saveSpeed, SPEED_RATE, type SpeedLevel } from './speechRate'

/** 取得／設定目前成員的朗讀速度 */
export function useSpeechRate(): {
  level: SpeedLevel
  rate: number
  setLevel: (level: SpeedLevel) => void
} {
  const { profile } = useProfile()
  const [level, setLevelState] = useState<SpeedLevel>(() => loadSpeed(profile?.id))

  const setLevel = useCallback(
    (next: SpeedLevel) => {
      setLevelState(next)
      saveSpeed(next, profile?.id)
    },
    [profile?.id],
  )

  return { level, rate: SPEED_RATE[level], setLevel }
}
