// 覆盤加練：一次一題，即答即對，最後給成績
import { useState } from 'react'
import type { DrillQuestion } from '../lib/types'

export default function PracticeQuiz({ questions }: { questions: DrillQuestion[] }) {
  const [index, setIndex] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [correct, setCorrect] = useState(0)

  const q = questions[index]
  const finished = index >= questions.length

  if (finished) {
    return (
      <div className="rounded-2xl bg-white p-5 text-center shadow-sm ring-1 ring-slate-200/60">
        <p className="text-3xl">{correct === questions.length ? '🏆' : '💪'}</p>
        <p className="mt-2 text-lg font-bold">
          加練完成：答對 {correct} / {questions.length}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {correct === questions.length
            ? '這個規則你抓到了，下次任務會拿來驗證'
            : '答錯的部分已記在錯誤庫，之後會再出現'}
        </p>
        <button
          onClick={() => {
            setIndex(0)
            setPicked(null)
            setCorrect(0)
          }}
          className="mt-4 rounded-xl bg-slate-100 px-5 py-2.5 font-semibold text-slate-600"
        >
          再練一次
        </button>
      </div>
    )
  }

  function pick(option: string) {
    if (picked !== null) return
    setPicked(option)
    if (option === q.answer) setCorrect((c) => c + 1)
  }

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/60">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-teal-700">
          類似題 {index + 1} / {questions.length}
        </p>
        <div className="flex gap-1">
          {questions.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-6 rounded-full ${i <= index ? 'bg-teal-500' : 'bg-slate-200'}`}
            />
          ))}
        </div>
      </div>

      <p className="mt-3 font-semibold leading-relaxed">{q.q}</p>

      <div className="mt-3 grid gap-2">
        {q.options.map((opt) => {
          const isAnswer = opt === q.answer
          const isPicked = opt === picked
          let cls = 'bg-slate-100 text-slate-700 active:bg-slate-200'
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
          {q.explain && <p className="mt-1 text-sm leading-relaxed text-slate-500">{q.explain}</p>}
          <button
            onClick={() => {
              setPicked(null)
              setIndex(index + 1)
            }}
            className="mt-3 w-full rounded-xl bg-teal-600 py-2.5 font-bold text-white"
          >
            {index + 1 < questions.length ? '下一題' : '看成績'}
          </button>
        </div>
      )}
    </div>
  )
}
