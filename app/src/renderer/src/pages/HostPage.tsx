import { useEffect, useRef, useState, useCallback } from 'react'
import { SignalingClient } from '../lib/signaling'
import { RemotePeer, setIceServers, type DataMsg } from '../lib/peer'

type Status = 'connecting' | 'waiting' | 'active' | 'error'

interface Props {
  signalingUrl: string
  onExit: () => void
}

export default function HostPage({ signalingUrl, onExit }: Props) {
  const [status, setStatus] = useState<Status>('connecting')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [permError, setPermError] = useState(false)
  const [copied, setCopied] = useState(false)
  const [inputOk, setInputOk] = useState(false)
  const [termOk, setTermOk] = useState(false)

  const sigRef = useRef<SignalingClient | null>(null)
  const peerRef = useRef<RemotePeer | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // Track active terminals (id on remote side → local pty id)
  const termMap = useRef<Map<string, string>>(new Map())
  // Use ref so useEffect doesn't re-run when handleDataMsg changes
  const handleDataMsgRef = useRef(handleDataMsg)

  // Keep ref in sync so useEffect doesn't re-run on handleDataMsg change
  useEffect(() => { handleDataMsgRef.current = handleDataMsg }, [handleDataMsg])

  // Check native module availability
  useEffect(() => {
    window.api.inputAvailable().then(setInputOk)
    window.api.terminalAvailable().then(setTermOk)
  }, [])

  // Handle data-channel messages from viewer
  const handleDataMsg = useCallback(async (msg: DataMsg) => {
    switch (msg.type) {
      case 'input-mouse-move':
        window.api.injectMouseMove(msg.x, msg.y)
        break
      case 'input-mouse-click':
        window.api.injectMouseClick(msg.x, msg.y, msg.button, msg.dbl)
        break
      case 'input-mouse-scroll':
        window.api.injectMouseScroll(msg.x, msg.y, msg.dx, msg.dy)
        break
      case 'input-mouse-drag':
        window.api.injectMouseDrag(msg.x, msg.y, msg.button, msg.pressed)
        break
      case 'input-key':
        window.api.injectKey(msg.key, msg.modifiers)
        break
      case 'input-type':
        window.api.injectType(msg.text)
        break

      case 'file-list-req': {
        const entries = await window.api.listDir(msg.path)
        peerRef.current?.send({ type: 'file-list-res', entries, reqId: msg.reqId })
        break
      }

      case 'file-send-req': {
        // Viewer wants to download a file from host
        const totalSize = await window.api.getFileSize(msg.path)
        const CHUNK = 65_536
        let offset = 0
        while (offset < totalSize) {
          const chunk = await window.api.readFileChunk(msg.path, offset, Math.min(CHUNK, totalSize - offset))
          peerRef.current?.send({ type: 'file-chunk', data: chunk, reqId: msg.reqId, offset, total: totalSize })
          offset += chunk.length
        }
        peerRef.current?.send({ type: 'file-send-done', reqId: msg.reqId })
        break
      }

      case 'file-receive-data': {
        // No-op: handled by viewer
        break
      }

      case 'terminal-create': {
        if (!termOk) {
          peerRef.current?.send({ type: 'terminal-created', termId: null, reqId: msg.reqId })
          break
        }
        const termId = await window.api.terminalCreate(msg.cols, msg.rows)
        if (termId) {
          termMap.current.set(msg.reqId, termId)
          // Forward pty output to viewer
          window.api.onTerminalData(termId, data => {
            peerRef.current?.send({ type: 'terminal-data', termId: msg.reqId, data })
          })
          window.api.onTerminalExit(termId, () => {
            peerRef.current?.send({ type: 'terminal-exit', termId: msg.reqId })
            termMap.current.delete(msg.reqId)
          })
        }
        peerRef.current?.send({ type: 'terminal-created', termId: termId ? msg.reqId : null, reqId: msg.reqId })
        break
      }

      case 'terminal-write': {
        const localId = termMap.current.get(msg.termId)
        if (localId) window.api.terminalWrite(localId, msg.data)
        break
      }

      case 'terminal-resize': {
        const localId = termMap.current.get(msg.termId)
        if (localId) window.api.terminalResize(localId, msg.cols, msg.rows)
        break
      }

      case 'terminal-destroy': {
        const localId = termMap.current.get(msg.termId)
        if (localId) { window.api.terminalDestroy(localId); termMap.current.delete(msg.termId) }
        break
      }
    }
  }, [termOk])

  useEffect(() => {
    const httpUrl = signalingUrl.replace(/^ws/, 'http')
    fetch(`${httpUrl}/ice-servers`).then(r => r.json()).then(setIceServers).catch(() => {})

    const sig = new SignalingClient(signalingUrl)
    sigRef.current = sig

    // Timeout: если за 15 секунд код не пришёл — показать ошибку
    let gotCode = false
    const timeout = setTimeout(() => {
      if (!gotCode) {
        setError('Сервер не отвечает. Проверь интернет и адрес в настройках.')
        setStatus('error')
      }
    }, 15000)

    sig.waitForOpen()
      .then(() => sig.send({ type: 'host' }))
      .catch(err => {
        clearTimeout(timeout)
        setError(`Не удалось подключиться: ${err.message}`)
        setStatus('error')
      })

    // Receive session code from server
    sig.on('code', ({ code }) => {
      gotCode = true
      clearTimeout(timeout)
      setCode(code)
      setStatus('waiting')
    })

    // 2. Viewer joined → start WebRTC
    sig.on('viewer-joined', async () => {
      const peer = new RemotePeer(sig, true, {
        onConnected: () => setStatus('active'),
        onDisconnected: () => {
          setStatus('waiting')
          streamRef.current?.getTracks().forEach(t => t.stop())
          streamRef.current = null
        },
        onError: e => setError(e),
        onDataMessage: (msg) => handleDataMsgRef.current(msg)
      })
      peerRef.current = peer

      try {
        // macOS: check screen recording permission
        const perm = await window.api.checkScreenPermission()
        if (perm !== 'granted') {
          setError('Нет разрешения на запись экрана.')
          setPermError(true)
          setStatus('error')
          peer.close()
          peerRef.current = null
          window.api.openScreenPermission()
          return
        }

        // Get screen source — prefer sources with id starting with 'screen:'
        const sources = await window.api.getScreenSources()
        const screen = sources.find(s => s.id.startsWith('screen:')) ?? sources[0]
        if (!screen) { setError('Источник экрана не найден'); peer.close(); return }

        // Захват видео экрана
        const videoStream = await (navigator.mediaDevices as unknown as {
          getUserMedia: (c: unknown) => Promise<MediaStream>
        }).getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: screen.id,
              maxWidth: 1920,
              maxHeight: 1080,
              maxFrameRate: 30
            }
          }
        })

        // Захват системного звука (работает на Windows; на macOS — только с доп. ПО)
        let audioStream: MediaStream | null = null
        try {
          audioStream = await (navigator.mediaDevices as unknown as {
            getUserMedia: (c: unknown) => Promise<MediaStream>
          }).getUserMedia({
            audio: { mandatory: { chromeMediaSource: 'desktop' } } as unknown,
            video: false as unknown
          })
        } catch {
          // Звук недоступен — продолжаем без него
        }

        const tracks = [
          ...videoStream.getVideoTracks(),
          ...(audioStream?.getAudioTracks() ?? [])
        ]
        const stream = new MediaStream(tracks)
        streamRef.current = stream

        await peer.addStream(stream)
        await peer.makeOffer()

        // Send screen size
        const size = await window.api.getScreenSize()
        peer.send({ type: 'screen-size', width: size.width, height: size.height })

        setStatus('active')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(`Не удалось захватить экран: ${msg}`)
        setStatus('error')
        // Notify viewer so it doesn't hang forever
        sig.send({ type: 'host-error', message: msg })
        peer.close()
        peerRef.current = null
      }
    })

    sig.on('disconnected', () => {
      setStatus('waiting')
      peerRef.current?.close()
      peerRef.current = null
    })

    sig.on('error', ({ message }) => {
      setError(message); setStatus('error')
    })

    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop())
      peerRef.current?.close()
      sig.close()
      termMap.current.forEach((id) => window.api.terminalDestroy(id))
    }
  }, [signalingUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  const copyCode = () => {
    window.api.copyText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="flex flex-col h-full bg-[#0f0f0f]">
      {/* Title bar */}
      <div className="drag-region h-10 flex items-center justify-between px-4 shrink-0">
        <div className="w-16" />
        <span className="no-drag text-xs text-neutral-600 select-none">Режим хоста</span>
        <button
          onClick={onExit}
          className="no-drag text-xs text-neutral-600 hover:text-neutral-300 transition-colors"
        >
          Выйти
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">

          {/* Status indicator */}
          {status === 'error' ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-5 text-center space-y-3">
              <p className="text-red-400 text-sm font-medium">Ошибка подключения</p>
              <p className="text-red-300/80 text-xs break-words">{error}</p>
              {permError && (
                <button
                  onClick={() => window.api.openScreenPermission()}
                  className="text-xs bg-accent hover:bg-accent-hover text-white px-3 py-1.5 rounded-lg transition-colors"
                >
                  Открыть Системные настройки
                </button>
              )}
              <button
                onClick={onExit}
                className="block w-full text-xs text-neutral-500 hover:text-neutral-300 transition-colors pt-1"
              >
                ← Назад
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2">
              <span className={`w-2 h-2 rounded-full ${
                status === 'active' ? 'bg-emerald-500 animate-pulse' :
                status === 'waiting' ? 'bg-yellow-500 animate-pulse' :
                'bg-neutral-600 animate-pulse'
              }`} />
              <span className="text-sm text-neutral-400">
                {status === 'connecting' && 'Подключение к серверу...'}
                {status === 'waiting' && 'Ожидание подключения...'}
                {status === 'active' && 'Активная сессия'}
              </span>
            </div>
          )}

          {/* Session code */}
          {code && (
            <div className="bg-[#1a1a1a] border border-border rounded-2xl p-6 text-center">
              <p className="text-xs text-neutral-500 mb-3 uppercase tracking-widest">Код сессии</p>
              <div className="flex justify-center gap-1.5 mb-4">
                {code.split('').map((ch, i) => (
                  <span key={i} className="code-char">{ch}</span>
                ))}
              </div>
              <p className="text-xs text-neutral-600 mb-4">
                Передайте этот код тому, кто хочет подключиться
              </p>
              <button
                onClick={copyCode}
                className="text-xs bg-[#2a2a2a] hover:bg-[#333] border border-border text-neutral-300 px-4 py-2 rounded-lg transition-colors"
              >
                {copied ? '✓ Скопировано' : 'Скопировать код'}
              </button>
            </div>
          )}

          {/* Capabilities */}
          {code && (
            <div className="flex gap-2 justify-center">
              <Cap ok={inputOk} label="Управление" />
              <Cap ok={termOk} label="Терминал" />
              <Cap ok label="Файлы" />
            </div>
          )}

          {status === 'active' && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
              <p className="text-sm text-emerald-400">Удалённый пользователь подключён</p>
              <p className="text-xs text-emerald-600 mt-1">Ваш экран транслируется</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Cap({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border ${
      ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
         : 'border-border bg-[#1a1a1a] text-neutral-600'
    }`}>
      <span>{ok ? '✓' : '✗'}</span>
      <span>{label}</span>
    </div>
  )
}
