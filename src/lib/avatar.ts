// 成員照片：在瀏覽器端裁切壓縮成小圖 data URL，直接存進 profiles.avatar_url
// 不使用 Supabase Storage，省去建 bucket 與權限設定

const SIZE = 256
const QUALITY = 0.82
const MAX_INPUT_BYTES = 12 * 1024 * 1024

export class AvatarError extends Error {}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new AvatarError('圖片讀取失敗，請換一張'))
    }
    img.src = url
  })
}

/**
 * 讀取使用者選的圖片，置中裁成正方形並縮到 256px，回傳 JPEG data URL。
 * 典型輸出 10-25KB，可安全存進資料庫欄位。
 */
export async function fileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new AvatarError('請選擇圖片檔')
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new AvatarError('圖片太大（超過 12MB），請換一張')
  }

  const img = await loadImage(file)
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new AvatarError('此瀏覽器不支援圖片處理')

  // 置中裁切：取原圖短邊為正方形來源
  const side = Math.min(img.naturalWidth, img.naturalHeight)
  const sx = (img.naturalWidth - side) / 2
  const sy = (img.naturalHeight - side) / 2
  ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE)

  return canvas.toDataURL('image/jpeg', QUALITY)
}
