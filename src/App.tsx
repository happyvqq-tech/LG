import { Routes, Route } from 'react-router-dom'
import RequireProfile from './components/RequireProfile'
import MemberSelect from './pages/MemberSelect'
import TaskHome from './pages/TaskHome'
import Listening from './pages/Listening'
import Reading from './pages/Reading'
import Speaking from './pages/Speaking'
import Writing from './pages/Writing'
import Feedback from './pages/Feedback'
import GrammarDrill from './pages/GrammarDrill'
import VocabHome from './pages/VocabHome'
import VocabSession from './pages/VocabSession'
import VocabList from './pages/VocabList'
import VocabQuiz from './pages/VocabQuiz'
import ClassicalHome from './pages/ClassicalHome'
import ClassicalRead from './pages/ClassicalRead'

function guarded(page: React.ReactNode) {
  return <RequireProfile>{page}</RequireProfile>
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MemberSelect />} />
      <Route path="/home" element={guarded(<TaskHome />)} />
      <Route path="/listening" element={guarded(<Listening />)} />
      <Route path="/reading" element={guarded(<Reading />)} />
      <Route path="/speaking" element={guarded(<Speaking />)} />
      <Route path="/writing" element={guarded(<Writing />)} />
      <Route path="/feedback" element={guarded(<Feedback />)} />
      <Route path="/grammar-drill" element={guarded(<GrammarDrill />)} />
      <Route path="/vocab" element={guarded(<VocabHome />)} />
      <Route path="/vocab/session" element={guarded(<VocabSession />)} />
      <Route path="/vocab/list" element={guarded(<VocabList />)} />
      <Route path="/vocab/quiz" element={guarded(<VocabQuiz />)} />
      <Route path="/classical" element={guarded(<ClassicalHome />)} />
      <Route path="/classical/:textId" element={guarded(<ClassicalRead />)} />
    </Routes>
  )
}
