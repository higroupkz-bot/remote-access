import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import crypto from 'crypto';

interface Session {
  code: string;
  host?: WebSocket;
  viewer?: WebSocket;
  hostId?: string;
  viewerId?: string;
}

// ICE servers can be overridden via env vars for private TURN deployment
const ICE_SERVERS = process.env.ICE_SERVERS
  ? JSON.parse(process.env.ICE_SERVERS)
  : [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ];

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/health') {
    res.writeHead(200);
    res.end('OK');
  } else if (req.url === '/ice-servers') {
    // Clients fetch this to get up-to-date ICE configuration
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ICE_SERVERS));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server });
const sessions = new Map<string, Session>();

function generateCode(): string {
  // 6-char alphanumeric code, easy to read/type
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

wss.on('connection', (ws) => {
  let sessionCode: string | null = null;
  let role: 'host' | 'viewer' | null = null;

  ws.on('message', (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'host': {
        // Host registers → get a fresh code
        let code: string;
        do { code = generateCode(); } while (sessions.has(code));
        sessionCode = code;
        role = 'host';
        sessions.set(code, { code, host: ws });
        ws.send(JSON.stringify({ type: 'code', code }));
        log(`Host registered, code=${code}`);
        break;
      }

      case 'join': {
        const code = msg.code as string;
        const session = sessions.get(code);
        if (!session) {
          ws.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
          return;
        }
        if (session.viewer) {
          ws.send(JSON.stringify({ type: 'error', message: 'Session already has a viewer' }));
          return;
        }
        session.viewer = ws;
        sessionCode = code;
        role = 'viewer';
        session.host?.send(JSON.stringify({ type: 'viewer-joined' }));
        ws.send(JSON.stringify({ type: 'joined' }));
        log(`Viewer joined, code=${code}`);
        break;
      }

      // WebRTC signaling relay — forward to the other peer
      case 'offer':
      case 'answer':
      case 'ice-candidate': {
        if (!sessionCode) return;
        const session = sessions.get(sessionCode);
        if (!session) return;
        const target = role === 'host' ? session.viewer : session.host;
        if (target?.readyState === WebSocket.OPEN) {
          target.send(JSON.stringify(msg));
        }
        break;
      }

      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  });

  ws.on('close', () => {
    if (!sessionCode) return;
    const session = sessions.get(sessionCode);
    if (!session) return;

    if (role === 'host') {
      session.viewer?.send(JSON.stringify({ type: 'disconnected', reason: 'host-left' }));
      sessions.delete(sessionCode);
      log(`Host disconnected, session ${sessionCode} removed`);
    } else if (role === 'viewer') {
      session.host?.send(JSON.stringify({ type: 'disconnected', reason: 'viewer-left' }));
      session.viewer = undefined;
      log(`Viewer disconnected from session ${sessionCode}`);
    }
  });

  ws.on('error', () => { /* silently ignore */ });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  log(`Signaling server listening on port ${PORT}`);
});
