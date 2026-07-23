import { Routes, Route } from 'react-router-dom'
import MemberSelect from './pages/MemberSelect'
import TaskHome from './pages/TaskHome'
import Listening from './pages/Listening'
import Reading from './pages/Reading'
import Speaking from './pages/Speaking'
import Writing from './pages/Writing'
import Feedback from './pages/Feedback'
import GrammarDrill from './pages/GrammarDrill'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MemberSelect />} />
      <Route path="/home" element={<TaskHome />} />
      <Route path="/listening" element={<Listening />} />
      <Route path="/reading" element={<Reading />} />
      <Route path="/speaking" element={<Speaking />} />
      <Route path="/writing" element={<Writing />} />
      <Route path="/feedback" element={<Feedback />} />
      <Route path="/grammar-drill" element={<GrammarDrill />} />
    </Routes>
  )
}
