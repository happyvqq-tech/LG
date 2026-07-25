// 成員頭像：有照片顯示照片，沒有就用名字首字
import type { Profile } from '../lib/types'

const SIZES = {
  sm: 'h-11 w-11 text-lg',
  md: 'h-14 w-14 text-2xl',
  lg: 'h-24 w-24 text-4xl',
} as const

export default function Avatar({
  profile,
  size = 'md',
  className = '',
}: {
  profile: Pick<Profile, 'name' | 'avatar_url'>
  size?: keyof typeof SIZES
  className?: string
}) {
  const base = `${SIZES[size]} shrink-0 overflow-hidden rounded-full ${className}`

  if (profile.avatar_url) {
    return (
      <img
        src={profile.avatar_url}
        alt={profile.name}
        className={`${base} object-cover ring-2 ring-white`}
      />
    )
  }

  return (
    <span
      className={`${base} flex items-center justify-center bg-gradient-to-br from-teal-500 to-teal-700 font-bold text-white`}
      aria-hidden
    >
      {profile.name.slice(0, 1)}
    </span>
  )
}
