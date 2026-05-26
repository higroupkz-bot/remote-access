import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  // ── Screen ──────────────────────────────────────────────
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  getScreenSize: () => ipcRenderer.invoke('get-screen-size'),
  inputAvailable: () => ipcRenderer.invoke('input-available'),

  // ── Input injection ─────────────────────────────────────
  injectMouseMove: (x: number, y: number) =>
    ipcRenderer.invoke('inject-mouse-move', x, y),
  injectMouseClick: (x: number, y: number, button: string, dbl: boolean) =>
    ipcRenderer.invoke('inject-mouse-click', x, y, button, dbl),
  injectMouseScroll: (x: number, y: number, dx: number, dy: number) =>
    ipcRenderer.invoke('inject-mouse-scroll', x, y, dx, dy),
  injectMouseDrag: (x: number, y: number, button: string, pressed: boolean) =>
    ipcRenderer.invoke('inject-mouse-drag', x, y, button, pressed),
  injectKey: (key: string, modifiers: string[]) =>
    ipcRenderer.invoke('inject-key', key, modifiers),
  injectType: (text: string) =>
    ipcRenderer.invoke('inject-type', text),

  // ── Terminal ─────────────────────────────────────────────
  terminalAvailable: () => ipcRenderer.invoke('terminal-available'),
  terminalCreate: (cols: number, rows: number) =>
    ipcRenderer.invoke('terminal-create', cols, rows),
  terminalWrite: (id: string, data: string) =>
    ipcRenderer.invoke('terminal-write', id, data),
  terminalResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.invoke('terminal-resize', id, cols, rows),
  terminalDestroy: (id: string) =>
    ipcRenderer.invoke('terminal-destroy', id),
  onTerminalData: (id: string, cb: (data: string) => void) => {
    const ch = `terminal-data:${id}`
    const handler = (_: unknown, d: string) => cb(d)
    ipcRenderer.on(ch, handler)
    return () => ipcRenderer.removeListener(ch, handler)
  },
  onTerminalExit: (id: string, cb: () => void) => {
    const ch = `terminal-exit:${id}`
    ipcRenderer.once(ch, cb)
    return () => ipcRenderer.removeAllListeners(ch)
  },

  // ── File system ──────────────────────────────────────────
  getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
  listDir: (path: string) => ipcRenderer.invoke('list-dir', path),
  readFileChunk: (path: string, offset: number, len: number) =>
    ipcRenderer.invoke('read-file-chunk', path, offset, len),
  getFileSize: (path: string) => ipcRenderer.invoke('get-file-size', path),
  writeFile: (path: string, data: number[]) =>
    ipcRenderer.invoke('write-file', path, data),
  ensureDir: (path: string) => ipcRenderer.invoke('ensure-dir', path),
  openSaveDialog: (name: string) => ipcRenderer.invoke('open-save-dialog', name),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  getVersion: () => ipcRenderer.invoke('get-version'),
  copyText: (text: string) => ipcRenderer.invoke('copy-text', text),

  // ── Platform info ────────────────────────────────────────
  platform: process.platform as string
})
