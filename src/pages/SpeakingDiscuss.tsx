// 討論文章重點：AI 就本次聽力稿的內容提問、追問，練「講得出重點」
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { DISCUSS_BOOTSTRAP, type DiscussPartnerInput } from '../lib/prompts/discussPartner'
import { updateTaskJson } from '../lib/taskService'
import { stopSpeaking } from '../lib/speech'
import TaskNav from '../components/TaskNav'
import SpeedPicker from '../components/SpeedPicker'
import VoiceChat from '../components/VoiceChat'
import { useSpeechRate } from '../lib/useSpeechRate'
import { asTaskLanguage } from '../lib/types'

export default function SpeakingDiscuss() {
  const navigate = useNavigate()
  const { task, setTask, loading } = useActiveTask()
  const { level: speedLevel, rate, setLevel: setSpeedLevel } = useSpeechRate()

  const prompt = useMemo(
    () => ({
      module: 'discussPartner' as const,
      vars: task
        ? ({
            language: asTaskLanguage(task.language),
            scenarioTitle: task.task_json.scenario_title,
            passage: task.task_json.listening_script,
          } satisfies DiscussPartnerInput)
        : null,
    }),
    [task],
  )

  if (loading || !task) return <p className="p-10 text-center text-slate-400">載入中…</p>

  return (
    <main className="mx-auto flex h-dvh max-w-xl lg:max-w-3xl flex-col p-4">
      <TaskNav current="speaking" />
      <header className="px-2">
        <button
          onClick={() => {
            stopSpeaking()
            navigate('/speaking')
          }}
          className="-ml-1 text-sm font-semibold text-slate-500"
        >
          ← 換個練習方式
        </button>
        <p className="mt-1 text-sm font-semibold text-teal-700">💬 討論文章重點</p>
        <h1 className="break-words text-xl font-bold">{task.task_json.scenario_title}</h1>
        <p className="mt-1 text-sm text-slate-500">用自己的話講出這篇的重點與看法</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-xs text-slate-400">語速</span>
          <SpeedPicker level={speedLevel} onChange={setSpeedLevel} showHint={false} compact />
        </div>
      </header>

      <VoiceChat
        language={task.language}
        prompt={prompt}
        bootstrap={DISCUSS_BOOTSTRAP}
        initialMessages={task.task_json.discuss_transcript ?? []}
        onMessages={(messages) => {
          void updateTaskJson(task, { discuss_transcript: messages }).then(setTask).catch(() => undefined)
        }}
        rate={rate}
        completeBanner="🎉 討論完成！重點都講出來了"
        completeLabel="回口說選單"
        onCompleteAction={() => navigate('/speaking')}
      />
    </main>
  )
}
