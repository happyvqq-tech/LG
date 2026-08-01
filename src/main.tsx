import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import AccessGate from './components/AccessGate'
import { ProfileProvider } from './lib/profileContext'
import './index.css'

// PWA 更新：之前只有 vite-plugin-pwa 自動注入的最陽春註冊腳本（只呼叫
// register()，沒有任何檢查更新的邏輯），導致 registerType: 'autoUpdate'
// 這個設定其實完全沒生效——新版本部署後，已安裝的 PWA 或沒關掉的分頁永遠
// 不會主動去檢查，改版可能好幾天都套用不到。這裡改用 virtual:pwa-register
// 自己控制：定期 + 回到前景時都主動檢查一次，抓到新版本就照 autoUpdate
// 的設計自動套用、不用使用者確認。
registerSW({
  onRegisteredSW(_url, registration) {
    if (!registration) return
    const checkForUpdate = () => void registration.update().catch(() => undefined)
    setInterval(checkForUpdate, 60 * 60 * 1000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
  },
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AccessGate>
      <HashRouter>
        <ProfileProvider>
          <App />
        </ProfileProvider>
      </HashRouter>
    </AccessGate>
  </React.StrictMode>,
)
