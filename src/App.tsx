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
    </Routes>
  )
}
