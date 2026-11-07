/**
 * UpBeat Windows Desktop Preload Script
 * Exposes native IPC methods and platform flags to the frontend safely.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('UpBeatNative', {
  platform: 'win32',
  isDesktop: true,
  isWindows: true,
  appVersion: '7.3.1',

  updatePlayback: (playing, title, artist, thumb, duration, currentTime) => {
    ipcRenderer.send('upbeat:update-playback', {
      playing: Boolean(playing),
      title: title || 'UpBeat',
      artist: artist || '',
      thumb: thumb || '',
      duration: duration || 0,
      currentTime: currentTime || 0
    })
  },

  syncFavorites: (itemsJson) => {
    ipcRenderer.send('upbeat:sync-favorites', itemsJson)
  },

  syncQueue: (itemsJson) => {
    ipcRenderer.send('upbeat:sync-queue', itemsJson)
  },

  openExternalUrl: (url) => {
    ipcRenderer.send('upbeat:open-external', url)
  },

  minimize: () => ipcRenderer.send('upbeat:minimize'),
  maximize: () => ipcRenderer.send('upbeat:maximize'),
  close: () => ipcRenderer.send('upbeat:close')
})
