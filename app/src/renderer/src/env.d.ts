/// <reference types="vite/client" />

interface ElectronAPI {
  getScreenSources: () => Promise<{ id: string; name: string; thumbnail: string }[]>
  getScreenSize: () => Promise<{ width: number; height: number }>
  inputAvailable: () => Promise<boolean>
  injectMouseMove: (x: number, y: number) => Promise<void>
  injectMouseClick: (x: number, y: number, button: string, dbl: boolean) => Promise<void>
  injectMouseScroll: (x: number, y: number, dx: number, dy: number) => Promise<void>
  injectMouseDrag: (x: number, y: number, button: string, pressed: boolean) => Promise<void>
  injectKey: (key: string, modifiers: string[]) => Promise<void>
  injectType: (text: string) => Promise<void>
  terminalAvailable: () => Promise<boolean>
  terminalCreate: (cols: number, rows: number) => Promise<string | null>
  terminalWrite: (id: string, data: string) => Promise<void>
  terminalResize: (id: string, cols: number, rows: number) => Promise<void>
  terminalDestroy: (id: string) => Promise<void>
  onTerminalData: (id: string, cb: (data: string) => void) => () => void
  onTerminalExit: (id: string, cb: () => void) => () => void
  getHomeDir: () => Promise<string>
  listDir: (path: string) => Promise<DirEntry[]>
  readFileChunk: (path: string, offset: number, len: number) => Promise<number[]>
  getFileSize: (path: string) => Promise<number>
  writeFile: (path: string, data: number[]) => Promise<void>
  ensureDir: (path: string) => Promise<void>
  openSaveDialog: (name: string) => Promise<string | null>
  openFileDialog: () => Promise<string | null>
  platform: string
}

interface DirEntry {
  name: string
  isDir: boolean
  size: number
  path: string
}

declare interface Window {
  api: ElectronAPI
}
