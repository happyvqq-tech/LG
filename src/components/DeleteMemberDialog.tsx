// 刪除成員的確認對話框：列出會連帶消失的東西，並要求輸入確認碼
//
// 刪除是 cascade 的（見 supabase/schema.sql 各表的 on delete cascade），
// 沒有復原按鈕，所以這裡刻意做得囉嗦：先講清楚會失去什麼，再要求輸入碼。
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { CASCADE_DELETED_ITEMS, isAdminPin } from '../lib/adminPin'
import type { Profile } from '../lib/types'

export default function DeleteMemberDialog({
  profile,
  onCancel,
  onDeleted,
}: {
  profile: Profile
  onCancel: () => void
  onDeleted: () => void
}) {
  const [pin, setPin] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  async function handleDelete() {
    if (!isAdminPin(pin)) {
      setErrorMsg('確認碼不對')
      return
    }
    setDeleting(true)
    setErrorMsg('')
    const { error } = await supabase.from('profiles').delete().eq('id', profile.id)
    if (error) {
      setDeleting(false)
      setErrorMsg(`刪除失敗：${error.message}`)
      return
    }
    onDeleted()
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-6 backdrop-blur-sm"
      // 這個對話框疊在編輯抽屜上，而抽屜的背景點擊會關掉自己。不擋住冒泡的話，
      // 取消刪除會連編輯抽屜一起關掉——使用者只是想反悔，不是想離開編輯
      onClick={(e) => {
        e.stopPropagation()
        onCancel()
      }}
    >
      <div
        className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-center text-4xl">⚠️</p>
        <h2 className="mt-3 text-center text-xl font-bold">
          刪除「{profile.name}」？
        </h2>
        <p className="mt-2 text-center text-sm text-red-600">這個動作無法復原</p>

        <div className="mt-4 rounded-2xl bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-800">會一起消失的資料：</p>
          <ul className="mt-2 grid gap-1">
            {CASCADE_DELETED_ITEMS.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-relaxed text-red-700">
                <span aria-hidden="true">・</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <label className="mt-5 block text-sm font-semibold text-slate-600" htmlFor="delete-pin">
          輸入確認碼才能刪除
        </label>
        <input
          id="delete-pin"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value)
            setErrorMsg('')
          }}
          type="password"
          // 手機跳數字鍵盤，比在全鍵盤上找數字快得多
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          placeholder="••••"
          className="mt-1 w-full rounded-xl border border-slate-300 p-3 text-center text-2xl tracking-[0.5em]"
        />

        {errorMsg && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-600">{errorMsg}</p>}

        <div className="mt-6 flex gap-3">
          <button
            onClick={onCancel}
            disabled={deleting}
            className="flex-1 rounded-xl bg-slate-100 py-3 font-semibold text-slate-600 disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={() => void handleDelete()}
            disabled={deleting || pin.length === 0}
            className="flex-1 rounded-xl bg-red-600 py-3 font-semibold text-white disabled:opacity-50"
          >
            {deleting ? '刪除中…' : '確定刪除'}
          </button>
        </div>
      </div>
    </div>
  )
}
