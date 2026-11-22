/**
 * UpBeat Windows Desktop Application Main Process
 * Supports Windows 10 & 11 with native tray, scoped media shortcuts,
 * hardware media controls, single-instance lock, and embedded audio microserver.
 */

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, session, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { startServer, DEFAULT_PORT } = require('./server.cjs')

const MAX_IPC_JSON_BYTES = 1024 * 1024 // 1 MB
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen'])

// 1. Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
  process.exit(0)
}

let mainWindow = null
let tray = null
let internalServer = null
let serverUrl = ''
let userDataDir = ''
let mediaShortcutsRegistered = false
let currentPlaybackState = {
  playing: false,
  title: 'UpBeat',
  artist: '',
  duration: 0,
  currentTime: 0
}
let syncedFavoritesSnapshot = []
let syncedQueueSnapshot = []

function isTrustedSender(event) {
  if (!serverUrl) return false
  const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || ''
  return senderUrl.startsWith(serverUrl)
}

function getIconPath() {
  const icoPath = path.join(__dirname, 'resources', 'icon.ico')
  if (fs.existsSync(icoPath)) return icoPath
  const pngPath = path.join(__dirname, 'resources', 'icon.png')
  if (fs.existsSync(pngPath)) return pngPath
  return undefined
}

function updateTrayMenu() {
  if (!tray) return

  const trackLabel = currentPlaybackState.title && currentPlaybackState.title !== 'UpBeat'
    ? `♫ ${currentPlaybackState.title}${currentPlaybackState.artist ? ` — ${currentPlaybackState.artist}` : ''}`
    : '♫ UpBeat Music Studio'

  const playPauseLabel = currentPlaybackState.playing ? 'Pause' : 'Play'

  const contextMenu = Menu.buildFromTemplate([
    {
      label: trackLabel.length > 38 ? `${trackLabel.slice(0, 35)}...` : trackLabel,
      enabled: false
    },
    { type: 'separator' },
    {
      label: playPauseLabel,
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript('window.UpBeatControls?.togglePlay?.()').catch(() => {})
        }
      }
    },
    {
      label: 'Next Track',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript('window.UpBeatControls?.next?.()').catch(() => {})
        }
      }
    },
    {
      label: 'Previous Track',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript('window.UpBeatControls?.prev?.()').catch(() => {})
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Open UpBeat',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    {
      label: 'Quit UpBeat',
      click: () => {
        app.isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.setToolTip(trackLabel)
}

function setupTray() {
  const iconPath = getIconPath()
  if (!iconPath) return

  try {
    tray = new Tray(iconPath)
    updateTrayMenu()

    tray.on('double-click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    })

    tray.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    })
  } catch (err) {
    console.warn('[UpBeat Desktop] Failed to create system tray:', err.message)
  }
}

function registerMediaShortcuts() {
  if (mediaShortcutsRegistered) return
  try {
    globalShortcut.register('MediaPlayPause', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript('window.UpBeatControls?.togglePlay?.()').catch(() => {})
      }
    })
    globalShortcut.register('MediaNextTrack', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript('window.UpBeatControls?.next?.()').catch(() => {})
      }
    })
    globalShortcut.register('MediaPreviousTrack', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript('window.UpBeatControls?.prev?.()').catch(() => {})
      }
    })
    globalShortcut.register('MediaStop', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript('window.UpBeatControls?.pause?.()').catch(() => {})
      }
    })
    mediaShortcutsRegistered = true
  } catch (err) {
    console.warn('[UpBeat Desktop] Global media shortcut registration notice:', err.message)
  }
}

function unregisterMediaShortcuts() {
  if (!mediaShortcutsRegistered) return
  try {
    globalShortcut.unregister('MediaPlayPause')
    globalShortcut.unregister('MediaNextTrack')
    globalShortcut.unregister('MediaPreviousTrack')
    globalShortcut.unregister('MediaStop')
  } catch {}
  mediaShortcutsRegistered = false
}

// Bind global media keys only while UpBeat is actively playing so SMTC and other
// paused or active desktop players are never hijacked when UpBeat is idle/paused.
function syncMediaShortcuts(isPlaying) {
  if (isPlaying) {
    registerMediaShortcuts()
  } else {
    unregisterMediaShortcuts()
  }
}

async function createWindow() {
  // Determine static files directory: packaged extraResources vs dev
  let staticDir = path.join(process.resourcesPath, 'frontend')
  if (!fs.existsSync(staticDir)) {
    staticDir = path.join(__dirname, '../frontend/dist')
  }
  if (!fs.existsSync(staticDir)) {
    staticDir = path.join(__dirname, 'frontend')
  }

  userDataDir = path.join(app.getPath('userData'), 'data')

  // Start internal microserver on deterministic dedicated port (48173 -> 48175)
  try {
    const srv = await startServer({
      preferredPort: DEFAULT_PORT,
      staticDir,
      userDataDir,
      version: app.getVersion() || '7.7.0'
    })
    internalServer = srv.server
    serverUrl = srv.url
  } catch (err) {
    console.error('[UpBeat Desktop] Failed to start internal server:', err)
    dialog.showErrorBox(
      'UpBeat Startup Error',
      `UpBeat could not start its local audio engine (${err?.message || 'port unavailable'}). Please close any conflicting UpBeat process and try again.`
    )
    app.isQuitting = true
    app.quit()
    return false
  }

  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0A0A0B',
    title: 'UpBeat',
    icon: getIconPath(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true
    }
  })

  mainWindow.removeMenu()

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('close', (event) => {
    if (!app.isQuitting && currentPlaybackState.playing) {
      // If song is currently playing, minimize to tray on close
      event.preventDefault()
      mainWindow.hide()
      if (tray) {
        tray.displayBalloon?.({
          title: 'UpBeat Still Playing',
          content: 'Music is still playing in the background. Click the tray icon to restore.'
        })
      }
    }
  })

  mainWindow.loadURL(serverUrl)

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith(serverUrl)) {
      event.preventDefault()
      if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
        shell.openExternal(targetUrl)
      }
    }
  })

  // Handle external link clicks (open in system default browser)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  return true
}

// Second instance focus
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  if (session?.defaultSession) {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      const url = webContents?.getURL?.() || ''
      const isLocal = Boolean(serverUrl) && url.startsWith(serverUrl)
      callback(isLocal && ALLOWED_PERMISSIONS.has(permission))
    })
    session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      const isLocal = Boolean(serverUrl) && (
        requestingOrigin?.startsWith(serverUrl) ||
        webContents?.getURL?.()?.startsWith(serverUrl)
      )
      return Boolean(isLocal && ALLOWED_PERMISSIONS.has(permission))
    })
  }

  const started = await createWindow()
  if (!started) return
  setupTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  unregisterMediaShortcuts()
  globalShortcut.unregisterAll()
  if (internalServer) {
    try { internalServer.close() } catch {}
  }
})

// IPC Handlers
ipcMain.on('upbeat:update-playback', (event, data) => {
  if (!isTrustedSender(event) || !data || typeof data !== 'object') return
  currentPlaybackState = {
    playing: Boolean(data.playing),
    title: typeof data.title === 'string' ? data.title.slice(0, 200) : 'UpBeat',
    artist: typeof data.artist === 'string' ? data.artist.slice(0, 200) : '',
    duration: Number(data.duration) || 0,
    currentTime: Number(data.currentTime) || 0
  }
  syncMediaShortcuts(currentPlaybackState.playing)
  updateTrayMenu()
})

ipcMain.on('upbeat:sync-favorites', (event, itemsJson) => {
  if (!isTrustedSender(event) || typeof itemsJson !== 'string') return
  if (Buffer.byteLength(itemsJson, 'utf8') > MAX_IPC_JSON_BYTES) return
  try {
    const parsed = JSON.parse(itemsJson)
    if (Array.isArray(parsed)) {
      syncedFavoritesSnapshot = parsed.slice(0, 200)
      if (userDataDir) {
        const dest = path.join(userDataDir, 'synced-favorites.json')
        fs.writeFileSync(dest, JSON.stringify(syncedFavoritesSnapshot), 'utf8')
      }
    }
  } catch {}
})

ipcMain.on('upbeat:sync-queue', (event, itemsJson) => {
  if (!isTrustedSender(event) || typeof itemsJson !== 'string') return
  if (Buffer.byteLength(itemsJson, 'utf8') > MAX_IPC_JSON_BYTES) return
  try {
    const parsed = JSON.parse(itemsJson)
    if (Array.isArray(parsed)) {
      syncedQueueSnapshot = parsed.slice(0, 200)
      if (userDataDir) {
        const dest = path.join(userDataDir, 'synced-queue.json')
        fs.writeFileSync(dest, JSON.stringify(syncedQueueSnapshot), 'utf8')
      }
    }
  } catch {}
})

ipcMain.on('upbeat:open-external', (event, url) => {
  if (!isTrustedSender(event)) return
  if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url)
  }
})

ipcMain.on('upbeat:minimize', (event) => {
  if (!isTrustedSender(event)) return
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
})

ipcMain.on('upbeat:maximize', (event) => {
  if (!isTrustedSender(event)) return
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  }
})

ipcMain.on('upbeat:close', (event) => {
  if (!isTrustedSender(event)) return
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
})
