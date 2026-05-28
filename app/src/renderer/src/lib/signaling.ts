export type SignalingMsg =
  | { type: 'code'; code: string }
  | { type: 'joined' }
  | { type: 'viewer-joined' }
  | { type: 'disconnected'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit }
  | { type: 'pong' }
  | { type: 'host-error'; message: string }

type Listener<T extends SignalingMsg['type']> = (
  msg: Extract<SignalingMsg, { type: T }>
) => void

export class SignalingClient {
  private ws: WebSocket
  private listeners = new Map<string, Set<Listener<SignalingMsg['type']>>>()
  private queue: object[] = []
  private _connected = false
  private pingTimer?: ReturnType<typeof setInterval>
  private openPromise: Promise<void>

  constructor(url: string) {
    this.ws = new WebSocket(url)

    // openPromise resolves when connected — waitForOpen() uses this,
    // so it never overwrites onopen and the queue flush always runs.
    this.openPromise = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true })
      this.ws.addEventListener('error', () => reject(new Error('Connection failed')), { once: true })
    })

    this.ws.onopen = () => {
      this._connected = true
      this.queue.forEach(m => this.ws.send(JSON.stringify(m)))
      this.queue = []
      this.pingTimer = setInterval(() => this.send({ type: 'ping' }), 20_000)
    }

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as SignalingMsg
        this.emit(msg.type, msg)
      } catch { /* ignore malformed */ }
    }

    this.ws.onclose = () => {
      this._connected = false
      clearInterval(this.pingTimer)
      this.emit('disconnected', { type: 'disconnected', reason: 'connection-lost' })
    }

    this.ws.onerror = () => {
      this.emit('error', { type: 'error', message: 'WebSocket connection failed' })
    }
  }

  send(msg: object) {
    if (this._connected) {
      this.ws.send(JSON.stringify(msg))
    } else {
      this.queue.push(msg)
    }
  }

  on<T extends SignalingMsg['type']>(type: T, fn: Listener<T>) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(fn as Listener<SignalingMsg['type']>)
    return () => this.off(type, fn)
  }

  off<T extends SignalingMsg['type']>(type: T, fn: Listener<T>) {
    this.listeners.get(type)?.delete(fn as Listener<SignalingMsg['type']>)
  }

  private emit(type: string, msg: unknown) {
    this.listeners.get(type)?.forEach(fn => fn(msg as SignalingMsg))
  }

  waitForOpen(): Promise<void> {
    return this.openPromise
  }

  get connected() { return this._connected }

  close() {
    clearInterval(this.pingTimer)
    this.ws.close()
  }
}
