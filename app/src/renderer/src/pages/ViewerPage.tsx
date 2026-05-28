import { useEffect, useRef, useState, useCallback } from 'react'
import { SignalingClient } from '../lib/signaling'
import { RemotePeer, setIceServers, type DataMsg } from '../lib/peer'
import { toRobotKey, toRobotModifiers } from '../lib/keymap'
import Terminal from '../components/Terminal'
import FileManager from '../components/FileManager'

type Panel = 'none' | 'terminal' | 'files'
type ConnState = 'connecting' | 'active' | 'disconnected' | 'error'

interface Props {
  code: string
  signalingUrl: string
  onExit: () => void
}

export default function ViewerPage({ code, signalingUrl, onExit }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const peerRef = useRef<RemotePeer | null>(null)
  const sigRef = useRef<SignalingClient | null>(null)

  const [connState, setConnState] = useState<ConnState>('connecting')
  const [errorMsg, setErrorMsg] = useState('')
  const [panel, setPanel] = useState<Panel>('none')
  const [showToolbar, setShowToolbar] = useState(true)
  const toolbarTimer = useRef<ReturnType<typeof setTimeout>>()

  // Remote screen dimensions (for coordinate scaling)
  const remoteSize = useRef({ width: 1920, height: 1080 })

  // Pending file/terminal request resolvers
  const pendingReqs = useRef<Map<string, (msg: DataMsg) => void>>(new Map())
  function reqId() { return Math.random().toString(36).slice(2, 10) }

  // ── Send file/terminal requests via peer ──────────────────────────────────
  const sendReq = useCallback((msg: DataMsg): Promise<DataMsg> => {
    return new Promise(resolve => {
      const id = (msg as Record<string, string>).reqId
      pendingReqs.current.set(id, resolve)
      peerRef.current?.send(msg)
    })
  }, [])

  // Exposed to child components
  const remoteApi = {
    listDir: async (path: string) => {
      const id = reqId()
      const res = await sendReq({ type: 'file-list-req', path, reqId: id })
      return (res as Extract<DataMsg, { type: 'file-list-res' }>).entries
    },
    downloadFile: async (path: string, name: string): Promise<Uint8Array> => {
      const id = reqId()
      const chunks: number[] = []
      return new Promise(resolve => {
        pendingReqs.current.set(`chunk:${id}`, (msg) => {
          const m = msg as Extract<DataMsg, { type: 'file-chunk' }>
          chunks.push(...m.data)
          if (chunks.length >= m.total) resolve(new Uint8Array(chunks))
        })
        pendingReqs.current.set(`done:${id}`, () => resolve(new Uint8Array(chunks)))
        peerRef.current?.send({ type: 'file-send-req', path, name, reqId: id })
      })
    },
    createTerminal: async (cols: number, rows: number) => {
      const id = reqId()
      const res = await sendReq({ type: 'terminal-create', cols, rows, reqId: id })
      return (res as Extract<DataMsg, { type: 'terminal-created' }>).termId
    },
    writeTerminal: (termId: string, data: string) => {
      peerRef.current?.send({ type: 'terminal-write', termId, data })
    },
    resizeTerminal: (termId: string, cols: number, rows: number) => {
      peerRef.current?.send({ type: 'terminal-resize', termId, cols, rows })
    },
    destroyTerminal: (termId: string) => {
      peerRef.current?.send({ type: 'terminal-destroy', termId })
    },
    onTerminalData: (termId: string, cb: (data: string) => void) => {
      const key = `tdata:${termId}`
      pendingReqs.current.set(key, (msg) => {
        cb((msg as Extract<DataMsg, { type: 'terminal-data' }>).data)
      })
      return () => pendingReqs.current.delete(key)
    }
  }

  // ── Handle incoming data messages ─────────────────────────────────────────
  const handleDataMsg = useCallback((msg: DataMsg) => {
    switch (msg.type) {
      case 'screen-size':
        remoteSize.current = { width: msg.width, height: msg.height }
        break

      case 'file-list-res': {
        const resolve = pendingReqs.current.get(msg.reqId)
        if (resolve) { resolve(msg); pendingReqs.current.delete(msg.reqId) }
        break
      }

      case 'file-chunk': {
        const chunkResolver = pendingReqs.current.get(`chunk:${msg.reqId}`)
        if (chunkResolver) chunkResolver(msg)
        if (msg.offset + msg.data.length >= msg.total) {
          const doneResolver = pendingReqs.current.get(`done:${msg.reqId}`)
          if (doneResolver) { doneResolver(msg); pendingReqs.current.delete(`done:${msg.reqId}`) }
        }
        break
      }

      case 'file-send-done': {
        pendingReqs.current.delete(`chunk:${msg.reqId}`)
        pendingReqs.current.delete(`done:${msg.reqId}`)
        break
      }

      case 'terminal-created': {
        const resolve = pendingReqs.current.get(msg.reqId)
        if (resolve) { resolve(msg); pendingReqs.current.delete(msg.reqId) }
        break
      }

      case 'terminal-data': {
        const cb = pendingReqs.current.get(`tdata:${msg.termId}`)
        if (cb) cb(msg)
        break
      }

      case 'terminal-exit': {
        pendingReqs.current.delete(`tdata:${msg.termId}`)
        break
      }
    }
  }, [])

  // ── WebRTC & signaling setup ──────────────────────────────────────────────
  useEffect(() => {
    const httpUrl = signalingUrl.replace(/^ws/, 'http')
    fetch(`${httpUrl}/ice-servers`)
      .then(r => r.json())
      .then(setIceServers)
      .catch(() => { /* use defaults */ })

    const sig = new SignalingClient(signalingUrl)
    sigRef.current = sig

    sig.waitForOpen().then(() => {
      sig.send({ type: 'join', code })
    }).catch(() => {
      setErrorMsg('Не удалось подключиться к серверу')
      setConnState('error')
    })

    sig.on('error', ({ message }) => {
      setErrorMsg(message)
      setConnState('error')
    })

    // Timeout: if no stream in 30s after joining, show error
    let streamTimeout: ReturnType<typeof setTimeout> | null = null

    sig.on('joined', () => {
      streamTimeout = setTimeout(() => {
        if (connState !== 'active') {
          setErrorMsg('Хост не отвечает — не удалось установить соединение')
          setConnState('disconnected')
        }
      }, 30_000)

      const peer = new RemotePeer(sig, false, {
        onRemoteStream: (stream) => {
          if (streamTimeout) { clearTimeout(streamTimeout); streamTimeout = null }
          if (videoRef.current) {
            videoRef.current.srcObject = stream
            videoRef.current.play().catch(() => {})
          }
          setConnState('active')
        },
        onConnected: () => {
          if (streamTimeout) { clearTimeout(streamTimeout); streamTimeout = null }
          setConnState('active')
        },
        onDisconnected: () => setConnState('disconnected'),
        onError: (e) => { setErrorMsg(e); setConnState('error') },
        onDataMessage: handleDataMsg
      })
      peerRef.current = peer
    })

    sig.on('host-error', ({ message }) => {
      if (streamTimeout) { clearTimeout(streamTimeout); streamTimeout = null }
      setErrorMsg(`Ошибка на стороне хоста: ${message}`)
      setConnState('disconnected')
    })

    sig.on('disconnected', ({ reason }) => {
      if (streamTimeout) { clearTimeout(streamTimeout); streamTimeout = null }
      setErrorMsg(reason === 'host-left' ? 'Хост завершил сессию' : 'Соединение разорвано')
      setConnState('disconnected')
    })

    return () => {
      if (streamTimeout) clearTimeout(streamTimeout)
      peerRef.current?.close()
      sig.close()
    }
  }, [code, signalingUrl, handleDataMsg])

  // ── Toolbar auto-hide ─────────────────────────────────────────────────────
  const resetToolbarTimer = useCallback(() => {
    setShowToolbar(true)
    clearTimeout(toolbarTimer.current)
    if (panel === 'none') {
      toolbarTimer.current = setTimeout(() => setShowToolbar(false), 3000)
    }
  }, [panel])

  // ── Mouse event forwarding ────────────────────────────────────────────────
  const scaleCoords = useCallback((clientX: number, clientY: number) => {
    const video = videoRef.current!
    const rect = video.getBoundingClientRect()
    const scaleX = remoteSize.current.width / rect.width
    const scaleY = remoteSize.current.height / rect.height
    return {
      x: Math.round((clientX - rect.left) * scaleX),
      y: Math.round((clientY - rect.top) * scaleY)
    }
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    resetToolbarTimer()
    if (connState !== 'active') return
    const { x, y } = scaleCoords(e.clientX, e.clientY)
    peerRef.current?.send({ type: 'input-mouse-move', x, y })
  }, [connState, scaleCoords, resetToolbarTimer])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (connState !== 'active') return
    const { x, y } = scaleCoords(e.clientX, e.clientY)
    const btn = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left'
    peerRef.current?.send({ type: 'input-mouse-drag', x, y, button: btn, pressed: true })
  }, [connState, scaleCoords])

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    if (connState !== 'active') return
    const { x, y } = scaleCoords(e.clientX, e.clientY)
    const btn = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left'
    peerRef.current?.send({ type: 'input-mouse-drag', x, y, button: btn, pressed: false })
  }, [connState, scaleCoords])

  const onClick = useCallback((e: React.MouseEvent) => {
    if (connState !== 'active') return
    const { x, y } = scaleCoords(e.clientX, e.clientY)
    const btn = e.button === 2 ? 'right' : 'left'
    peerRef.current?.send({ type: 'input-mouse-click', x, y, button: btn, dbl: false })
  }, [connState, scaleCoords])

  const onDblClick = useCallback((e: React.MouseEvent) => {
    if (connState !== 'active') return
    const { x, y } = scaleCoords(e.clientX, e.clientY)
    peerRef.current?.send({ type: 'input-mouse-click', x, y, button: 'left', dbl: true })
  }, [connState, scaleCoords])

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (connState !== 'active') return
    const { x, y } = scaleCoords(e.clientX, e.clientY)
    peerRef.current?.send({ type: 'input-mouse-scroll', x, y, dx: Math.round(e.deltaX / 10), dy: Math.round(e.deltaY / 10) })
  }, [connState, scaleCoords])

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (connState !== 'active') return
    const { x, y } = scaleCoords(e.clientX, e.clientY)
    peerRef.current?.send({ type: 'input-mouse-click', x, y, button: 'right', dbl: false })
  }, [connState, scaleCoords])

  // ── Keyboard forwarding ───────────────────────────────────────────────────
  useEffect(() => {
    if (panel !== 'none') return
    const handler = (e: KeyboardEvent) => {
      if (connState !== 'active') return
      // Разрешить только Cmd+Tab (переключение окон) и Cmd+Q (выход)
      if ((e.metaKey && e.key === 'Tab') || (e.metaKey && e.key === 'q')) return

      e.preventDefault()
      e.stopPropagation()

      const mods = toRobotModifiers(e)
      const hasModifier = e.ctrlKey || e.metaKey || e.altKey

      // Printable chars без модификаторов (работает с любой раскладкой: Latin, Кириллица, etc.)
      if (!hasModifier && e.key.length === 1) {
        peerRef.current?.send({ type: 'input-type', text: e.key })
        return
      }

      // Спецклавиши и шорткаты (Ctrl+C, Cmd+V, Enter, стрелки...)
      const key = toRobotKey(e.key)
      if (key) {
        peerRef.current?.send({ type: 'input-key', key, modifiers: mods })
      }
    }
    // capture: true — перехватываем до того как Electron обработает
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [connState, panel])

  // ── Render ────────────────────────────────────────────────────────────────
  if (connState === 'error' || connState === 'disconnected') {
    return (
      <div className="flex flex-col h-full bg-[#0f0f0f] items-center justify-center gap-4">
        <div className="text-red-400 text-sm">{errorMsg || 'Соединение потеряно'}</div>
        <button onClick={onExit} className="text-sm text-accent hover:text-accent-hover transition-colors">
          ← Назад
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full bg-black relative overflow-hidden" onMouseMove={resetToolbarTimer}>
      {/* Remote video */}
      <video
        ref={videoRef}
        id="remote-video"
        autoPlay
        onMouseMove={onMouseMove}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onClick={onClick}
        onDoubleClick={onDblClick}
        onWheel={onWheel}
        onContextMenu={onContextMenu}
        className={`flex-1 ${panel !== 'none' ? 'w-1/2' : 'w-full'}`}
        style={{ cursor: 'none' }}
      />

      {/* Side panel */}
      {panel === 'terminal' && (
        <div className="w-1/2 border-l border-border bg-[#0d0d0d] flex flex-col">
          <PanelHeader title="Терминал" onClose={() => setPanel('none')} />
          <Terminal remoteApi={remoteApi} />
        </div>
      )}
      {panel === 'files' && (
        <div className="w-1/2 border-l border-border bg-[#0d0d0d] flex flex-col">
          <PanelHeader title="Файлы" onClose={() => setPanel('none')} />
          <FileManager remoteApi={remoteApi} />
        </div>
      )}

      {/* Connecting overlay */}
      {connState === 'connecting' && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="text-center space-y-3">
            <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-neutral-400">Подключение...</p>
            <p className="text-xs text-neutral-600">Код: <span className="font-mono text-neutral-400">{code}</span></p>
          </div>
        </div>
      )}

      {/* Floating toolbar — pointer-events-none на фоне, чтобы мышь проходила насквозь к видео */}
      <div
        className={`absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2
          bg-gradient-to-b from-black/60 to-transparent transition-opacity duration-300 pointer-events-none
          ${showToolbar || panel !== 'none' ? 'opacity-100' : 'opacity-0'}`}
      >
        <div className="flex-1 h-8" />
        <div className="no-drag flex items-center gap-2 pointer-events-auto">
          <ToolBtn
            active={panel === 'terminal'}
            onClick={() => setPanel(p => p === 'terminal' ? 'none' : 'terminal')}
            title="Терминал"
          >
            <TermIcon />
          </ToolBtn>
          <ToolBtn
            active={panel === 'files'}
            onClick={() => setPanel(p => p === 'files' ? 'none' : 'files')}
            title="Файлы"
          >
            <FolderIcon />
          </ToolBtn>
          <div className="w-px h-4 bg-white/20" />
          <ToolBtn onClick={onExit} title="Отключиться">
            <DisconnectIcon />
          </ToolBtn>
        </div>
      </div>
    </div>
  )
}

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
      <span className="text-sm font-medium text-neutral-300">{title}</span>
      <button onClick={onClose} className="text-neutral-600 hover:text-neutral-300 transition-colors text-lg leading-none">
        ×
      </button>
    </div>
  )
}

function ToolBtn({ children, onClick, title, active }: {
  children: React.ReactNode; onClick: () => void; title: string; active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors
        ${active ? 'bg-accent text-white' : 'bg-black/40 hover:bg-white/20 text-white/70 hover:text-white'}`}
    >
      {children}
    </button>
  )
}

function TermIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1" y="2" width="14" height="12" rx="2"/>
      <path d="M4 6l3 2-3 2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M9 10h3" strokeLinecap="round"/>
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4a1 1 0 011-1h3.586a1 1 0 01.707.293L8 4h5a1 1 0 011 1v7a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"/>
    </svg>
  )
}

function DisconnectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M10 6l4-4M14 6l-4-4" strokeLinecap="round"/>
      <path d="M2.5 9.5l4 4 1.5-1.5-4-4L2.5 9.5z" strokeLinejoin="round"/>
      <path d="M9.5 2.5l4 4-1.5 1.5-4-4 1.5-1.5z" strokeLinejoin="round"/>
    </svg>
  )
}
