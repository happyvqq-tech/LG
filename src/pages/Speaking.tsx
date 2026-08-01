// 口說關卡的入口：先選練習方式，再進到各自的頁面
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { splitSentences } from '../lib/speech'
import TaskNav from '../components/TaskNav'

interface Mode {
  path: string
  icon: string
  title: string
  desc: string
  /** 這個模式已經做過的話顯示的標記 */
  doneLabel?: string
}

export default function Speaking() {
  const navigate = useNavigate()
  const { task, loading } = useActiveTask()

  if (loading || !task) return <p className="p-10 text-center text-slate-400">載入中…</p>

  const { discuss_transcript, speaking_transcript, listening_script } = task.task_json
  const sentenceCount = splitSentences(listening_script).length

  const modes: Mode[] = [
    {
      path: '/speaking/discuss',
      icon: '💬',
      title: '討論文章重點',
      desc: 'AI 就這篇文章的內容提問，你用英文把重點和看法講出來',
      doneLabel: discuss_transcript && discuss_transcript.length > 0 ? '進行中' : undefined,
    },
    {
      path: '/shadowing',
      icon: '🔁',
      title: '跟讀朗讀評分',
      desc: `AI 唸一句、你跟著唸一次，即時評分，80 分才過關（共 ${sentenceCount} 句）`,
    },
    {
      path: '/speaking/roleplay',
      icon: '🎭',
      title: '情境角色對話',
      desc: `AI 扮演「${task.task_json.speaking_role_setup}」跟你對話，目標是${task.task_json.speaking_goal}`,
      doneLabel: speaking_transcript && speaking_transcript.length > 0 ? '進行中' : undefined,
    },
    {
      // 流利度是 Nation 四股裡唯一沒被其他關卡覆蓋的一股（見 lib/fluencyRounds.ts）。
      // 放在最後：它的前提是內容已經練過了，先做這個等於在練還不會的東西
      path: '/fluency',
      icon: '⏱️',
      title: '流利度訓練 4/3/2',
      desc: '同一段話講三次，時間一次比一次短。不學新東西，只練把會的講快',
    },
  ]

  return (
    <main className="mx-auto flex min-h-screen max-w-xl lg:max-w-3xl flex-col p-6 pb-10">
      <TaskNav current="speaking" />
      <header>
        <p className="text-sm font-semibold text-teal-700">第三關・口說</p>
        <h1 className="mt-1 break-words text-2xl font-bold">{task.task_json.scenario_title}</h1>
        <p className="mt-1 text-slate-500">選一種方式練習，都可以做</p>
      </header>

      <div className="mt-6 grid gap-3">
        {modes.map((m) => (
          <button
            key={m.path}
            onClick={() => navigate(m.path)}
            className="flex items-center gap-4 rounded-2xl bg-white p-5 text-left shadow-sm ring-1 ring-slate-200/60 transition active:scale-[0.98]"
          >
            <span className="text-3xl">{m.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold">{m.title}</span>
                {m.doneLabel && (
                  <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
                    {m.doneLabel}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block break-words text-sm text-slate-500">{m.desc}</span>
            </span>
            <span className="shrink-0 text-slate-300">→</span>
          </button>
        ))}
      </div>

      <button
        onClick={() => navigate('/writing')}
        className="mt-8 w-full rounded-xl bg-teal-600 py-3.5 text-lg font-bold text-white active:scale-95"
      >
        練完了 → 進入寫作
      </button>
    </main>
  )
}
