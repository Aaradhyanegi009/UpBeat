/**
 * UpBeat Windows Desktop Application Main Process
 * Supports Windows 10 & 11 with native tray, media shortcuts,
 * hardware media controls, single-instance lock, and embedded audio microserver.
 */

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, session } = require('electron')
const path = require('path')
const fs = require('fs')
const { startServer } = require('./server.cjs')

// 1. Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
  process.exit(0)
}

let mainWindow = null
let tray = null
let internalServer = null
let currentPlaybackState = {
  playing: false,
  title: 'UpBeat',
  artist: '',
  duration: 0,
  currentTime: 0
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
        if (mainWindow) mainWindow.webContents.executeJavaScript('window.UpBeatControls?.togglePlay?.()')
      }
    },
    {
      label: 'Next Track',
      click: () => {
        if (mainWindow) mainWindow.webContents.executeJavaScript('window.UpBeatControls?.next?.()')
      }
    },
    {
      label: 'Previous Track',
      click: () => {
        if (mainWindow) mainWindow.webContents.executeJavaScript('window.UpBeatControls?.prev?.()')
      }
    },
    { type: 'separator' },
    {
      label: 'Open UpBeat',
      click: () => {
        if (mainWindow) {
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
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
    })

    tray.on('click', () => {
      if (mainWindow) {
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
  try {
    globalShortcut.register('MediaPlayPause', () => {
      if (mainWindow) mainWindow.webContents.executeJavaScript('window.UpBeatControls?.togglePlay?.()')
    })
    globalShortcut.register('MediaNextTrack', () => {
      if (mainWindow) mainWindow.webContents.executeJavaScript('window.UpBeatControls?.next?.()')
    })
    globalShortcut.register('MediaPreviousTrack', () => {
      if (mainWindow) mainWindow.webContents.executeJavaScript('window.UpBeatControls?.prev?.()')
    })
    globalShortcut.register('MediaStop', () => {
      if (mainWindow) mainWindow.webContents.executeJavaScript('window.UpBeatControls?.pause?.()')
    })
  } catch (err) {
    console.warn('[UpBeat Desktop] Global media shortcut registration notice:', err.message)
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

  const userDataDir = path.join(app.getPath('userData'), 'data')

  // Start internal microserver
  try {
    const srv = await startServer({
      preferredPort: 8000,
      staticDir,
      userDataDir,
      version: app.getVersion() || '7.3.1'
    })
    internalServer = srv.server
  } catch (err) {
    console.error('[UpBeat Desktop] Failed to start internal server:', err)
  }

  const serverUrl = internalServer ? `http://127.0.0.1:${internalServer.address().port}` : 'http://127.0.0.1:8000'

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

  // Handle external link clicks (open in system default browser)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })
}

// Second instance focus
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  if (session?.defaultSession) {
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
      if (permission === 'media') return callback(true)
      callback(true)
    })
  }

  await createWindow()
  setupTray()
  registerMediaShortcuts()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (internalServer) {
    try { internalServer.close() } catch {}
  }
})

// IPC Handlers
ipcMain.on('upbeat:update-playback', (event, data) => {
  currentPlaybackState = { ...currentPlaybackState, ...data }
  updateTrayMenu()
})

ipcMain.on('upbeat:open-external', (event, url) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url)
  }
})

ipcMain.on('upbeat:minimize', () => {
  if (mainWindow) mainWindow.minimize()
})

ipcMain.on('upbeat:maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
  }
})

ipcMain.on('upbeat:close', () => {
  if (mainWindow) mainWindow.close()
})
