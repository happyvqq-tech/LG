import { Routes, Route, Navigate } from 'react-router-dom'
import RequireProfile from './components/RequireProfile'
import { TAIGI_ENABLED } from './lib/features'
import MemberSelect from './pages/MemberSelect'
import TaskHome from './pages/TaskHome'
import TaskArchive from './pages/TaskArchive'
import TaskReview from './pages/TaskReview'
import BackTranslate from './pages/BackTranslate'
import Listening from './pages/Listening'
import ListeningCloze from './pages/ListeningCloze'
import Reading from './pages/Reading'
import Speaking from './pages/Speaking'
import SpeakingDiscuss from './pages/SpeakingDiscuss'
import SpeakingRoleplay from './pages/SpeakingRoleplay'
import Shadowing from './pages/Shadowing'
import Fluency from './pages/Fluency'
import ExtensiveHome from './pages/ExtensiveHome'
import ExtensivePlayer from './pages/ExtensivePlayer'
import Writing from './pages/Writing'
import Feedback from './pages/Feedback'
import VocabHome from './pages/VocabHome'
import VocabSession from './pages/VocabSession'
import VocabList from './pages/VocabList'
import VocabQuiz from './pages/VocabQuiz'
import TaigiHome from './pages/TaigiHome'
import TaigiListening from './pages/TaigiListening'
import TaigiShadowing from './pages/TaigiShadowing'
import ClassicalHome from './pages/ClassicalHome'
import ClassicalRead from './pages/ClassicalRead'
import ErrorReview from './pages/ErrorReview'
import ParticleSession from './pages/ParticleSession'
import WeeklyReport from './pages/WeeklyReport'

function guarded(page: React.ReactNode) {
  return <RequireProfile>{page}</RequireProfile>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MemberSelect />} />
      <Route path="/home" element={guarded(<TaskHome />)} />
      <Route path="/archive" element={guarded(<TaskArchive />)} />
      <Route path="/archive/:taskId" element={guarded(<TaskReview />)} />
      <Route path="/archive/:taskId/back-translate" element={guarded(<BackTranslate />)} />
      <Route path="/listening" element={guarded(<Listening />)} />
      <Route path="/listening-cloze" element={guarded(<ListeningCloze />)} />
      <Route path="/reading" element={guarded(<Reading />)} />
      <Route path="/speaking" element={guarded(<Speaking />)} />
      <Route path="/speaking/discuss" element={guarded(<SpeakingDiscuss />)} />
      <Route path="/speaking/roleplay" element={guarded(<SpeakingRoleplay />)} />
      <Route path="/shadowing" element={guarded(<Shadowing />)} />
      <Route path="/fluency" element={guarded(<Fluency />)} />
      <Route path="/extensive" element={guarded(<ExtensiveHome />)} />
      <Route path="/extensive/:id" element={guarded(<ExtensivePlayer />)} />
      <Route path="/writing" element={guarded(<Writing />)} />
      <Route path="/feedback" element={guarded(<Feedback />)} />
      <Route path="/vocab" element={guarded(<VocabHome />)} />
      <Route path="/vocab/session" element={guarded(<VocabSession />)} />
      <Route path="/vocab/list" element={guarded(<VocabList />)} />
      <Route path="/vocab/quiz" element={guarded(<VocabQuiz />)} />
      {/* 台語：程式完成，但要有雅婷金鑰才有聲音，先由 features.ts 關起來。
          路由也一起關掉，不然直接打網址還是進得去、進去也只會看到錯誤。 */}
      {TAIGI_ENABLED && (
        <>
          <Route path="/taigi" element={guarded(<TaigiHome />)} />
          <Route path="/taigi/:scriptId/listening" element={guarded(<TaigiListening />)} />
          <Route path="/taigi/:scriptId/shadowing" element={guarded(<TaigiShadowing />)} />
        </>
      )}
      <Route path="/classical" element={guarded(<ClassicalHome />)} />
      <Route path="/classical/particles" element={guarded(<ParticleSession />)} />
      <Route path="/classical/:textId" element={guarded(<ClassicalRead />)} />
      <Route path="/error-review/:language" element={guarded(<ErrorReview />)} />
      <Route path="/weekly-report" element={guarded(<WeeklyReport />)} />
      {/* 任何打不到的網址（含被 features.ts 關掉的 /taigi）都導回首頁，
          不要讓 <Routes> 沒有匹配時預設渲染空內容，變成一片空白 */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
