import { useState, useEffect } from 'react'
import type { Page } from '../App'

const DEFAULT_SERVER = 'wss://server-any-production.up.railway.app'

interface Props {
  onNavigate: (page: Page) => void
}

export default function HomePage({ onNavigate }: Props) {
  const [codeInput, setCodeInput] = useState('')
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [tab, setTab] = useState<'host' | 'connect'>('host')
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.api.getVersion().then(setVersion)
  }, [])

  const handleConnect = () => {
    const code = codeInput.trim().toUpperCase()
    if (code.length !== 6) return
    onNavigate({ name: 'viewer', code, signalingUrl: serverUrl })
  }

  const handleHost = () => {
    onNavigate({ name: 'host', signalingUrl: serverUrl })
  }

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Title bar drag region */}
      <div className="drag-region h-10 flex items-center px-4 shrink-0">
        <span className="no-drag text-xs text-neutral-600 ml-20 select-none">Remote Access</span>
      </div>

      {/* Center card */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-3">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.5">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <path d="M8 21h8M12 17v4"/>
                <path d="M9 10l-3 3 3 3" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15 10l3 3-3 3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-neutral-100">Удалённый доступ</h1>
            <p className="text-xs text-neutral-500 mt-1">Быстрое и безопасное подключение</p>
          </div>

          {/* Tabs */}
          <div className="flex bg-[#1a1a1a] rounded-xl p-1 mb-5 border border-border">
            <button
              onClick={() => setTab('host')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === 'host'
                  ? 'bg-[#2a2a2a] text-neutral-100 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              Раздать доступ
            </button>
            <button
              onClick={() => setTab('connect')}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === 'connect'
                  ? 'bg-[#2a2a2a] text-neutral-100 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-300'
              }`}
            >
              Подключиться
            </button>
          </div>

          {tab === 'host' ? (
            <div className="space-y-3">
              <p className="text-sm text-neutral-400 text-center px-2">
                Запустите сессию — вам дадут код, который нужно передать другому человеку.
              </p>
              <button
                onClick={handleHost}
                className="w-full py-3 bg-accent hover:bg-accent-hover active:opacity-90 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                Начать сессию
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-neutral-500 mb-1.5 block">Код сессии</label>
                <input
                  type="text"
                  maxLength={6}
                  value={codeInput}
                  onChange={e => setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  onKeyDown={e => e.key === 'Enter' && handleConnect()}
                  placeholder="XXXXXX"
                  className="w-full bg-[#1a1a1a] border border-border focus:border-accent text-neutral-100 text-center text-xl font-mono tracking-[0.3em] rounded-xl py-3 outline-none transition-colors placeholder:text-neutral-700 placeholder:tracking-[0.3em]"
                />
              </div>
              <button
                onClick={handleConnect}
                disabled={codeInput.length !== 6}
                className="w-full py-3 bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
              >
                Подключиться
              </button>
            </div>
          )}

          {/* Advanced: server URL */}
          <div className="mt-5">
            <button
              onClick={() => setShowAdvanced(v => !v)}
              className="text-xs text-neutral-600 hover:text-neutral-400 transition-colors w-full text-center"
            >
              {showAdvanced ? '▲ Скрыть настройки' : '▼ Расширенные настройки'}
            </button>
            {showAdvanced && (
              <div className="mt-3">
                <label className="text-xs text-neutral-500 mb-1.5 block">Signaling-сервер</label>
                <input
                  type="text"
                  value={serverUrl}
                  onChange={e => setServerUrl(e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-border focus:border-accent text-neutral-300 text-xs rounded-lg py-2 px-3 outline-none transition-colors font-mono"
                />
                <p className="text-xs text-neutral-600 mt-1">
                  Запустите свой сервер: <code className="text-neutral-500">cd server && npm run dev</code>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Version badge at the bottom */}
      <div className="pb-5 text-center">
        <span className="text-xs text-neutral-500">{version ? `v${version}` : ''}</span>
      </div>
    </div>
  )
}
