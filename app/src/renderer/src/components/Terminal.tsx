import { useEffect, useRef, useState } from 'react'

interface RemoteApi {
  createTerminal: (cols: number, rows: number) => Promise<string | null>
  writeTerminal: (id: string, data: string) => void
  resizeTerminal: (id: string, cols: number, rows: number) => void
  destroyTerminal: (id: string) => void
  onTerminalData: (id: string, cb: (data: string) => void) => () => void
}

interface Props {
  remoteApi: RemoteApi
}

// Minimal VT100/ANSI renderer — writes raw output to a textarea-like div
// In a real app you'd use @xterm/xterm; here we keep zero extra deps
export default function Terminal({ remoteApi }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [termId, setTermId] = useState<string | null>(null)
  const [lines, setLines] = useState<string[]>([''])
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading')
  const inputBuf = useRef('')
  const unsubRef = useRef<(() => void) | null>(null)

  const cols = 80
  const rows = 24

  useEffect(() => {
    let id: string | null = null

    remoteApi.createTerminal(cols, rows).then(tid => {
      if (!tid) { setStatus('unavailable'); return }
      id = tid
      setTermId(tid)
      setStatus('ready')

      unsubRef.current = remoteApi.onTerminalData(tid, data => {
        // Append raw output — strip ANSI for simplicity
        const plain = data.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
                          .replace(/\x1b\][^\x07]*\x07/g, '')
                          .replace(/\x1b[()][AB012]/g, '')
        setLines(prev => {
          const all = [...prev]
          for (const ch of plain) {
            if (ch === '\r') continue
            if (ch === '\n') { all.push(''); continue }
            if (ch === '\b') {
              const last = all[all.length - 1]
              if (last.length > 0) all[all.length - 1] = last.slice(0, -1)
              continue
            }
            all[all.length - 1] += ch
          }
          // Keep last 1000 lines
          return all.length > 1000 ? all.slice(-1000) : all
        })
      })
    })

    return () => {
      unsubRef.current?.()
      if (id) remoteApi.destroyTerminal(id)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll on new output
  useEffect(() => {
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!termId) return
    e.stopPropagation() // prevent forwarding to remote desktop
    e.preventDefault()

    let data = ''
    switch (e.key) {
      case 'Enter':      data = '\r'; break
      case 'Backspace':  data = '\x7f'; break
      case 'Tab':        data = '\t'; break
      case 'Escape':     data = '\x1b'; break
      case 'ArrowUp':    data = '\x1b[A'; break
      case 'ArrowDown':  data = '\x1b[B'; break
      case 'ArrowRight': data = '\x1b[C'; break
      case 'ArrowLeft':  data = '\x1b[D'; break
      case 'Home':       data = '\x1b[H'; break
      case 'End':        data = '\x1b[F'; break
      case 'Delete':     data = '\x1b[3~'; break
      case 'PageUp':     data = '\x1b[5~'; break
      case 'PageDown':   data = '\x1b[6~'; break
      default:
        if (e.ctrlKey && e.key.length === 1) {
          data = String.fromCharCode(e.key.toUpperCase().charCodeAt(0) - 64)
        } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
          data = e.key
        }
    }
    if (data) remoteApi.writeTerminal(termId, data)
  }

  if (status === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-600 text-sm">
        <div className="w-4 h-4 border border-neutral-600 border-t-transparent rounded-full animate-spin mr-2" />
        Запуск терминала...
      </div>
    )
  }

  if (status === 'unavailable') {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-600 text-sm text-center px-6">
        Терминал недоступен на хосте.<br/>
        <span className="text-xs mt-1 text-neutral-700">node-pty не установлен или не перекомпилирован.</span>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex-1 overflow-y-auto p-3 font-mono text-xs text-green-400 bg-[#080808] outline-none leading-5 cursor-text"
      style={{ fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace" }}
    >
      {lines.map((line, i) => (
        <div key={i} className="whitespace-pre-wrap break-all min-h-[1.25rem]">
          {line}
          {i === lines.length - 1 && (
            <span className="inline-block w-2 h-3.5 bg-green-400 align-middle ml-px animate-pulse" />
          )}
        </div>
      ))}
    </div>
  )
}
