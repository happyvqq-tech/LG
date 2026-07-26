// 版本號／更新日期，build 時由 vite.config.ts 從 git 注入，不用每次改版手動維護
function formatDate(iso: string): string {
  // __BUILD_DATE__ 是 git commit 的 ISO 時間，只取日期部分即可
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[1]}/${m[2]}/${m[3]}` : iso
}

export default function AppVersion() {
  return (
    <p className="mt-6 text-right text-xs text-slate-300">
      {formatDate(__BUILD_DATE__)} · v{__APP_VERSION__}
    </p>
  )
}
