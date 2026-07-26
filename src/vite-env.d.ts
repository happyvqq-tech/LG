/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_WORKER_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** 這次部署的 git short hash，build 時由 vite.config.ts 注入 */
declare const __APP_VERSION__: string
/** 這次部署對應 commit 的時間，build 時由 vite.config.ts 注入 */
declare const __BUILD_DATE__: string
