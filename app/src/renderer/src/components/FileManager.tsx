import { useEffect, useState, useCallback } from 'react'

interface DirEntry { name: string; isDir: boolean; size: number; path: string }

interface RemoteApi {
  listDir: (path: string) => Promise<DirEntry[]>
  downloadFile: (path: string, name: string) => Promise<Uint8Array>
}

interface Props {
  remoteApi: RemoteApi
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(1)} GB`
}

export default function FileManager({ remoteApi }: Props) {
  const [path, setPath] = useState('/')
  const [entries, setEntries] = useState<DirEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [error, setError] = useState('')

  const loadDir = useCallback(async (p: string) => {
    setLoading(true)
    setError('')
    try {
      const list = await remoteApi.listDir(p)
      setEntries(list)
      setPath(p)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [remoteApi])

  useEffect(() => { loadDir('/') }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const navigateUp = () => {
    const parts = path.replace(/\/$/, '').split('/')
    if (parts.length <= 1) return
    parts.pop()
    loadDir(parts.join('/') || '/')
  }

  const download = async (entry: DirEntry) => {
    setDownloading(entry.name)
    try {
      const data = await remoteApi.downloadFile(entry.path, entry.name)
      // Save via browser download
      const blob = new Blob([data])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = entry.name
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      setError((e as Error).message)
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden text-sm">
      {/* Breadcrumb / path bar */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border bg-[#111] shrink-0">
        <button onClick={navigateUp} disabled={path === '/'} className="text-neutral-500 hover:text-neutral-300 disabled:opacity-30 transition-colors text-base leading-none">
          ↑
        </button>
        <span className="text-xs text-neutral-500 font-mono truncate flex-1">{path}</span>
        <button onClick={() => loadDir(path)} className="text-neutral-600 hover:text-neutral-300 transition-colors text-xs">
          ↻
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="px-3 py-2 text-xs text-red-400 bg-red-500/10 border-b border-red-500/20">
          {error}
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-24 text-neutral-600 text-xs">
            <div className="w-4 h-4 border border-neutral-600 border-t-transparent rounded-full animate-spin mr-2" />
            Загрузка...
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-neutral-700 text-xs">
            Папка пуста
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-neutral-600 border-b border-border">
                <th className="text-left px-3 py-1.5 font-normal">Имя</th>
                <th className="text-right px-3 py-1.5 font-normal w-20">Размер</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr
                  key={e.path}
                  className="border-b border-border/50 hover:bg-white/5 transition-colors group"
                >
                  <td className="px-3 py-1.5">
                    <button
                      onClick={() => e.isDir ? loadDir(e.path) : download(e)}
                      className="flex items-center gap-2 text-left w-full"
                    >
                      <span className="text-base leading-none">
                        {e.isDir ? '📁' : fileIcon(e.name)}
                      </span>
                      <span className={`truncate max-w-[160px] ${e.isDir ? 'text-sky-400' : 'text-neutral-300'}`}>
                        {e.name}
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-1.5 text-right text-neutral-600">
                    {e.isDir ? '—' : fmtSize(e.size)}
                  </td>
                  <td className="px-2 py-1.5">
                    {!e.isDir && (
                      <button
                        onClick={() => download(e)}
                        disabled={downloading === e.name}
                        title="Скачать"
                        className="opacity-0 group-hover:opacity-100 text-neutral-500 hover:text-accent transition-all text-base leading-none disabled:animate-spin"
                      >
                        {downloading === e.name ? '↻' : '↓'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    js: '📜', ts: '📜', jsx: '⚛️', tsx: '⚛️',
    py: '🐍', rb: '💎', go: '🐹', rs: '🦀',
    json: '📋', yaml: '📋', yml: '📋', toml: '📋',
    md: '📝', txt: '📝', pdf: '📄',
    png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️',
    mp4: '🎬', mov: '🎬', avi: '🎬',
    mp3: '🎵', wav: '🎵', flac: '🎵',
    zip: '🗜️', tar: '🗜️', gz: '🗜️', rar: '🗜️',
    sh: '⚡', bash: '⚡', zsh: '⚡',
    html: '🌐', css: '🎨',
  }
  return map[ext] ?? '📄'
}
