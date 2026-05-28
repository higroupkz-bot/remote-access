import {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  systemPreferences,
  dialog,
  session,
  clipboard,
  shell
} from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, statSync, writeFileSync, mkdirSync, appendFileSync } from 'fs'
import os from 'os'
import crypto from 'crypto'
import { autoUpdater } from 'electron-updater'

// Simple file logger for auto-updater diagnostics
let _logPath = ''
function updLog(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  console.log('[updater]', msg)
  try {
    if (!_logPath) _logPath = join(app.getPath('userData'), 'updater.log')
    appendFileSync(_logPath, line)
  } catch { /* ignore */ }
}

// Lazy-load native modules (need electron-rebuild after npm install)
let robot: typeof import('@jitsi/robotjs') | null = null
let pty: typeof import('node-pty') | null = null

try {
  robot = require('@jitsi/robotjs')
} catch {
  console.warn('robotjs not available — input injection disabled')
}

try {
  pty = require('node-pty')
} catch {
  console.warn('node-pty not available — terminal disabled')
}

// ─── Window ──────────────────────────────────────────────────────────────────

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 760,
    minHeight: 540,
    backgroundColor: '#0f0f0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // Allow getUserMedia for screen capture
    }
  })

  // Allow screen capture via getUserMedia
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media' || permission === 'display-capture') callback(true)
    else callback(false)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // F12 opens DevTools for diagnostics
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'F12') win.webContents.openDevTools()
  })

  return win
}

app.whenReady().then(async () => {
  // macOS: request screen recording permission
  if (process.platform === 'darwin') {
    const screenStatus = systemPreferences.getMediaAccessStatus('screen')
    if (screenStatus !== 'granted') {
      console.log('Screen recording permission needed')
    }
    // Accessibility for input injection
    if (robot && !systemPreferences.isTrustedAccessibilityClient(false)) {
      const result = await dialog.showMessageBox({
        type: 'info',
        title: 'Требуется разрешение',
        message: 'Remote Access нужен доступ к специальным возможностям для управления мышью и клавиатурой.',
        detail: 'Откройте Системные настройки → Конфиденциальность → Специальные возможности и добавьте приложение.',
        buttons: ['Открыть настройки', 'Пропустить']
      })
      if (result.response === 0) {
        systemPreferences.isTrustedAccessibilityClient(true)
      }
    }
  }

  const win = createWindow()

  // ── Автообновление ──────────────────────────────────────────────────────
  // Только в продакшне (в dev-режиме не проверяем)
  if (!process.env['ELECTRON_RENDERER_URL']) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false

    autoUpdater.on('checking-for-update', () => {
      updLog(`Checking for update (current: ${app.getVersion()})`)
      win.webContents.send('update-status', { type: 'checking' })
    })

    autoUpdater.on('update-available', (info) => {
      updLog(`Update available: ${info.version}`)
      win.webContents.send('update-status', { type: 'available', version: info.version })
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'Доступно обновление',
        message: `Найдена версия ${info.version}`,
        detail: 'Скачивается в фоне. Когда будет готово — появится кнопка "Перезапустить".',
        buttons: ['OK']
      })
    })

    autoUpdater.on('update-not-available', (info) => {
      updLog(`No update available, latest: ${info.version}`)
      win.webContents.send('update-status', { type: 'not-available' })
    })

    autoUpdater.on('download-progress', (p) => {
      const pct = Math.round(p.percent)
      updLog(`Downloading: ${pct}%`)
      win.setProgressBar(p.percent / 100)
      win.setTitle(`Remote Access — скачивание обновления ${pct}%`)
    })

    autoUpdater.on('update-downloaded', (info) => {
      win.setProgressBar(-1)
      win.setTitle('Remote Access')
      updLog(`Update downloaded: ${info.version}`)
      win.webContents.send('update-status', { type: 'downloaded', version: info.version })
      dialog.showMessageBox(win, {
        type: 'info',
        title: 'Обновление готово',
        message: `Версия ${info.version} скачана`,
        detail: 'Нажми "Перезапустить" чтобы установить сейчас, или закрой приложение позже.',
        buttons: ['Перезапустить сейчас', 'Позже']
      }).then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall()
      })
    })

    autoUpdater.on('error', (err) => {
      win.setProgressBar(-1)
      win.setTitle('Remote Access')
      updLog(`Error: ${err.message}`)
      win.webContents.send('update-status', { type: 'error', message: err.message })
      dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Ошибка обновления',
        message: 'Не удалось проверить или скачать обновление.',
        detail: `Скачай вручную:\ngithub.com/higroupkz-bot/remote-access/releases/latest\n\nОшибка: ${err.message}`,
        buttons: ['OK']
      })
    })

    const runCheck = () => {
      updLog('Running checkForUpdates...')
      autoUpdater.checkForUpdates().catch(err => {
        updLog(`checkForUpdates rejected: ${err.message}`)
      })
    }

    // Проверять при запуске и каждые 4 часа
    runCheck()
    setInterval(runCheck, 4 * 60 * 60 * 1000)
  }

  // IPC: ручная проверка обновлений
  ipcMain.handle('check-for-updates', () => {
    if (process.env['ELECTRON_RENDERER_URL']) return 'dev-mode'
    updLog('Manual check requested')
    autoUpdater.checkForUpdates().catch(err => {
      updLog(`Manual check failed: ${err.message}`)
    })
    return 'checking'
  })

  // IPC: прочитать лог обновлений
  ipcMain.handle('get-update-log', () => {
    try {
      if (!_logPath) _logPath = join(app.getPath('userData'), 'updater.log')
      const { readFileSync } = require('fs') as typeof import('fs')
      return readFileSync(_logPath, 'utf8')
    } catch { return '(лог пуст)' }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── IPC: Screen Sources ──────────────────────────────────────────────────────

ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: false
  })
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL()
  }))
})

// ─── IPC: Input Injection ─────────────────────────────────────────────────────

ipcMain.handle('inject-mouse-move', (_e, x: number, y: number) => {
  robot?.moveMouse(Math.round(x), Math.round(y))
})

ipcMain.handle('inject-mouse-click', (_e, x: number, y: number, button: string, double: boolean) => {
  robot?.moveMouse(Math.round(x), Math.round(y))
  robot?.mouseClick(button as 'left' | 'right' | 'middle', double)
})

ipcMain.handle('inject-mouse-scroll', (_e, x: number, y: number, dx: number, dy: number) => {
  robot?.moveMouse(Math.round(x), Math.round(y))
  robot?.scrollMouse(dx, dy)
})

ipcMain.handle('inject-mouse-drag', (_e, x: number, y: number, button: string, pressed: boolean) => {
  robot?.moveMouse(Math.round(x), Math.round(y))
  if (pressed) robot?.mouseToggle('down', button as 'left' | 'right')
  else robot?.mouseToggle('up', button as 'left' | 'right')
})

ipcMain.handle('inject-key', (_e, key: string, modifiers: string[]) => {
  try {
    robot?.keyTap(key, modifiers)
  } catch { /* invalid key, ignore */ }
})

ipcMain.handle('inject-type', (_e, text: string) => {
  robot?.typeString(text)
})

ipcMain.handle('get-screen-size', () => {
  const size = robot?.getScreenSize() ?? { width: 1920, height: 1080 }
  return size
})

ipcMain.handle('input-available', () => robot !== null)
ipcMain.handle('get-version', () => app.getVersion())
ipcMain.handle('copy-text', (_e, text: string) => clipboard.writeText(text))
ipcMain.handle('check-screen-permission', () => {
  if (process.platform !== 'darwin') return 'granted'
  return systemPreferences.getMediaAccessStatus('screen')
})
ipcMain.handle('open-screen-permission', () => {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
})

// ─── IPC: Terminal (node-pty) ─────────────────────────────────────────────────

const terminals = new Map<string, ReturnType<typeof pty.spawn>>()

ipcMain.handle('terminal-create', (event, cols: number, rows: number) => {
  if (!pty) return null
  const id = crypto.randomUUID()
  const shell = process.platform === 'win32'
    ? 'powershell.exe'
    : (process.env.SHELL ?? '/bin/bash')

  const term = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: os.homedir(),
    env: process.env as Record<string, string>
  })

  terminals.set(id, term)

  term.onData(data => {
    event.sender.send(`terminal-data:${id}`, data)
  })

  term.onExit(() => {
    terminals.delete(id)
    event.sender.send(`terminal-exit:${id}`)
  })

  return id
})

ipcMain.handle('terminal-write', (_e, id: string, data: string) => {
  terminals.get(id)?.write(data)
})

ipcMain.handle('terminal-resize', (_e, id: string, cols: number, rows: number) => {
  terminals.get(id)?.resize(cols, rows)
})

ipcMain.handle('terminal-destroy', (_e, id: string) => {
  const term = terminals.get(id)
  if (term) { term.kill(); terminals.delete(id) }
})

ipcMain.handle('terminal-available', () => pty !== null)

// ─── IPC: File System ─────────────────────────────────────────────────────────

ipcMain.handle('get-home-dir', () => os.homedir())

ipcMain.handle('list-dir', (_e, dirPath: string) => {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    return entries.map(e => {
      const fullPath = join(dirPath, e.name)
      let size = 0
      try { size = e.isFile() ? statSync(fullPath).size : 0 } catch { /* skip */ }
      return { name: e.name, isDir: e.isDirectory(), size, path: fullPath }
    }).sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch (err: unknown) {
    throw new Error(`Cannot list ${dirPath}: ${(err as Error).message}`)
  }
})

ipcMain.handle('read-file-chunk', (_e, filePath: string, offset: number, length: number) => {
  const buf = Buffer.alloc(length)
  const fs = require('fs') as typeof import('fs')
  const fd = fs.openSync(filePath, 'r')
  const read = fs.readSync(fd, buf, 0, length, offset)
  fs.closeSync(fd)
  return Array.from(buf.slice(0, read))
})

ipcMain.handle('get-file-size', (_e, filePath: string) => {
  return statSync(filePath).size
})

ipcMain.handle('write-file', (_e, filePath: string, data: number[]) => {
  writeFileSync(filePath, Buffer.from(data))
})

ipcMain.handle('ensure-dir', (_e, dirPath: string) => {
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true })
})

ipcMain.handle('open-save-dialog', async (_e, defaultName: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: join(os.homedir(), 'Downloads', defaultName),
    properties: ['createDirectory']
  })
  return result.filePath ?? null
})

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    defaultPath: os.homedir()
  })
  return result.filePaths[0] ?? null
})
