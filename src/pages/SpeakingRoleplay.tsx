// 情境角色對話（CLAUDE.md 6.2）：AI 扮演任務裡的角色，跟使用者拉鋸達成目標
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveTask } from '../lib/useActiveTask'
import { DIALOG_BOOTSTRAP, type DialogPartnerInput } from '../lib/prompts/dialogPartner'
import { updateTaskJson } from '../lib/taskService'
import { stopSpeaking } from '../lib/speech'
import TaskNav from '../components/TaskNav'
import SpeedPicker from '../components/SpeedPicker'
import VoiceChat from '../components/VoiceChat'
import { useSpeechRate } from '../lib/useSpeechRate'
import { asTaskLanguage } from '../lib/types'

export default function SpeakingRoleplay() {
  const navigate = useNavigate()
  const { task, setTask, loading } = useActiveTask()
  const { level: speedLevel, rate, setLevel: setSpeedLevel } = useSpeechRate()

  const prompt = useMemo(
    () => ({
      module: 'dialogPartner' as const,
      vars: task
        ? ({
            language: asTaskLanguage(task.language),
            roleSetup: task.task_json.speaking_role_setup,
            goal: task.task_json.speaking_goal,
          } satisfies DialogPartnerInput)
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
        <p className="mt-1 text-sm font-semibold text-teal-700">🎭 情境角色對話</p>
        <h1 className="break-words text-xl font-bold">{task.task_json.scenario_title}</h1>
        <p className="mt-1 text-sm text-slate-500">目標：{task.task_json.speaking_goal}</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-xs text-slate-400">語速</span>
          <SpeedPicker level={speedLevel} onChange={setSpeedLevel} showHint={false} compact />
        </div>
      </header>

      <VoiceChat
        language={task.language}
        prompt={prompt}
        bootstrap={DIALOG_BOOTSTRAP}
        initialMessages={task.task_json.speaking_transcript ?? []}
        onMessages={(messages) => {
          void updateTaskJson(task, { speaking_transcript: messages }).then(setTask).catch(() => undefined)
        }}
        rate={rate}
        completeBanner="🎉 任務達成！口說練習完成"
        completeLabel="進入寫作"
        onCompleteAction={() => navigate('/writing')}
      />
    </main>
  )
}
