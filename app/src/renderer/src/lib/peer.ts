import { SignalingClient } from './signaling'

export interface PeerCallbacks {
  onRemoteStream?: (stream: MediaStream) => void
  onDataMessage?: (msg: DataMsg) => void
  onConnected?: () => void
  onDisconnected?: () => void
  onError?: (err: string) => void
}

export type DataMsg =
  | { type: 'screen-size'; width: number; height: number }
  | { type: 'input-mouse-move'; x: number; y: number }
  | { type: 'input-mouse-click'; x: number; y: number; button: string; dbl: boolean }
  | { type: 'input-mouse-scroll'; x: number; y: number; dx: number; dy: number }
  | { type: 'input-mouse-drag'; x: number; y: number; button: string; pressed: boolean }
  | { type: 'input-key'; key: string; modifiers: string[] }
  | { type: 'input-type'; text: string }
  | { type: 'file-list-req'; path: string; reqId: string }
  | { type: 'file-list-res'; entries: DirEntry[]; reqId: string }
  | { type: 'file-send-req'; path: string; name: string; reqId: string }
  | { type: 'file-chunk'; data: number[]; reqId: string; offset: number; total: number }
  | { type: 'file-send-done'; reqId: string }
  | { type: 'file-receive-req'; name: string; size: number; reqId: string }
  | { type: 'file-receive-data'; data: number[]; reqId: string }
  | { type: 'file-receive-done'; reqId: string }
  | { type: 'terminal-create'; cols: number; rows: number; reqId: string }
  | { type: 'terminal-created'; termId: string | null; reqId: string }
  | { type: 'terminal-write'; termId: string; data: string }
  | { type: 'terminal-data'; termId: string; data: string }
  | { type: 'terminal-resize'; termId: string; cols: number; rows: number }
  | { type: 'terminal-destroy'; termId: string }
  | { type: 'terminal-exit'; termId: string }

interface DirEntry { name: string; isDir: boolean; size: number; path: string }

// ICE servers are fetched from the signaling server so they can be
// configured without rebuilding the app (esp. for private TURN servers).
// Falls back to Google STUN + free public TURN if server doesn't provide them.
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Free public TURN relay — works through strict NAT, mobile networks, etc.
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:443?transport=tcp'
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject'
  }
]

let ICE_SERVERS = DEFAULT_ICE_SERVERS

export function setIceServers(servers: RTCIceServer[]) {
  ICE_SERVERS = servers.length ? servers : DEFAULT_ICE_SERVERS
}

export class RemotePeer {
  private pc: RTCPeerConnection
  private dc?: RTCDataChannel
  private cbs: PeerCallbacks

  constructor(
    private signaling: SignalingClient,
    private isHost: boolean,
    callbacks: PeerCallbacks
  ) {
    this.cbs = callbacks
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })

    // ICE candidates → signaling
    this.pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        signaling.send({ type: 'ice-candidate', candidate: candidate.toJSON() })
      }
    }

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState
      if (state === 'connected') this.cbs.onConnected?.()
      else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.cbs.onDisconnected?.()
      }
    }

    if (isHost) {
      // Host creates data channel
      this.dc = this.pc.createDataChannel('control', { ordered: true })
      this.setupDC(this.dc)
    } else {
      // Viewer receives data channel
      this.pc.ondatachannel = (e) => {
        this.dc = e.channel
        this.setupDC(this.dc)
      }
      // Receive remote stream (host screen)
      this.pc.ontrack = (e) => {
        this.cbs.onRemoteStream?.(e.streams[0])
      }
    }

    // Wire up signaling messages
    signaling.on('offer', async ({ sdp }) => {
      await this.pc.setRemoteDescription(sdp)
      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      signaling.send({ type: 'answer', sdp: this.pc.localDescription! })
    })

    signaling.on('answer', async ({ sdp }) => {
      await this.pc.setRemoteDescription(sdp)
    })

    signaling.on('ice-candidate', async ({ candidate }) => {
      try { await this.pc.addIceCandidate(candidate) } catch { /* ignore */ }
    })
  }

  // Host: add screen media stream
  async addStream(stream: MediaStream) {
    stream.getTracks().forEach(t => this.pc.addTrack(t, stream))
  }

  // Host: create and send offer
  async makeOffer() {
    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)
    this.signaling.send({ type: 'offer', sdp: this.pc.localDescription! })
  }

  send(msg: DataMsg) {
    if (this.dc?.readyState === 'open') {
      this.dc.send(JSON.stringify(msg))
    }
  }

  private setupDC(dc: RTCDataChannel) {
    dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as DataMsg
        this.cbs.onDataMessage?.(msg)
      } catch { /* ignore */ }
    }
  }

  close() {
    this.dc?.close()
    this.pc.close()
  }
}
