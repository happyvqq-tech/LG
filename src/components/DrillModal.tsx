import { useState } from 'react'
import type { GraderError } from '../lib/types'

/** 30 秒微課彈窗：規則說明 + 即答即對選擇題 */
export default function DrillModal({ error, onClose }: { error: GraderError; onClose: () => void }) {
  const [qIndex, setQIndex] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)

  const questions = error.drill
  const q = questions[qIndex]
  const done = qIndex >= questions.length

  function pick(option: string) {
    if (picked !== null) return
    setPicked(option)
  }

  function next() {
    setPicked(null)
    setQIndex(qIndex + 1)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-5" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-teal-700">30 秒微課・{error.error_type}</p>
        <p className="mt-2 rounded-xl bg-teal-50 p-3 text-slate-700">{error.rule_note}</p>
        <p className="mt-2 text-sm text-slate-500">
          <span className="text-red-500 line-through">{error.original}</span>
          {' → '}
          <span className="font-semibold text-green-600">{error.corrected}</span>
        </p>

        {!done && q && (
          <div className="mt-5">
            <p className="font-semibold">
              練習 {qIndex + 1}/{questions.length}：{q.q}
            </p>
            <div className="mt-3 grid gap-2">
              {q.options.map((opt) => {
                const isAnswer = opt === q.answer
                const isPicked = opt === picked
                let cls = 'bg-slate-100 text-slate-700'
                if (picked !== null) {
                  if (isAnswer) cls = 'bg-green-100 text-green-700 ring-2 ring-green-500'
                  else if (isPicked) cls = 'bg-red-100 text-red-600'
                  else cls = 'bg-slate-50 text-slate-400'
                }
                return (
                  <button
                    key={opt}
                    onClick={() => pick(opt)}
                    className={`rounded-xl p-3 text-left font-medium transition ${cls}`}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
            {picked !== null && (
              <div className="mt-3">
                <p className={picked === q.answer ? 'font-bold text-green-600' : 'font-bold text-red-600'}>
                  {picked === q.answer ? '答對了！' : `正確答案：${q.answer}`}
                </p>
                {q.explain && <p className="mt-1 text-sm text-slate-500">{q.explain}</p>}
                <button
                  onClick={next}
                  className="mt-3 w-full rounded-xl bg-teal-600 py-2.5 font-bold text-white"
                >
                  {qIndex + 1 < questions.length ? '下一題' : '完成'}
                </button>
              </div>
            )}
          </div>
        )}

        {(done || questions.length === 0) && (
          <div className="mt-5 text-center">
            {questions.length > 0 && <p className="text-2xl">✅</p>}
            <p className="mt-2 text-slate-600">
              {questions.length > 0 ? '微課完成！' : '這個錯誤沒有附練習題'}
            </p>
            <button onClick={onClose} className="mt-4 w-full rounded-xl bg-slate-100 py-2.5 font-bold text-slate-600">
              關閉
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
