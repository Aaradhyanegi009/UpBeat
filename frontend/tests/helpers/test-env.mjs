import { registerHooks } from 'node:module'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

class MemoryStorage {
  constructor() {
    this._map = new Map()
  }
  get length() {
    return this._map.size
  }
  clear() {
    this._map.clear()
  }
  getItem(k) {
    return this._map.has(String(k)) ? this._map.get(String(k)) : null
  }
  setItem(k, v) {
    this._map.set(String(k), String(v))
  }
  removeItem(k) {
    this._map.delete(String(k))
  }
  key(i) {
    return Array.from(this._map.keys())[i] ?? null
  }
}

const localStore = new MemoryStorage()
const sessionStore = new MemoryStorage()

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  enumerable: true,
  writable: true,
  value: localStore
})

Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  enumerable: true,
  writable: true,
  value: sessionStore
})

// Provide a minimal window stub on demand while avoiding automatic interval loops during jamEngine import.
export function resetStorage() {
  localStore.clear()
  sessionStore.clear()
}

export function withWindowStub(fn) {
  const prevWindow = globalThis.window
  globalThis.window = {
    location: { origin: 'https://upbeat.example.com', pathname: '/', search: '', hash: '', port: '' },
    localStorage: localStore,
    sessionStorage: sessionStore
  }
  try {
    return fn()
  } finally {
    if (prevWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = prevWindow
    }
  }
}

let hooksRegistered = false
export function ensureEsmTestHooks() {
  if (hooksRegistered) return
  hooksRegistered = true
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'peerjs') {
        return { shortCircuit: true, url: 'mock:peerjs' }
      }
      if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.(js|mjs|json)$/i.test(specifier)) {
        const candidate = new URL(`${specifier}.js`, context.parentURL)
        if (fs.existsSync(fileURLToPath(candidate))) {
          return { shortCircuit: true, url: candidate.href }
        }
      }
      return nextResolve(specifier, context)
    },
    load(url, context, nextLoad) {
      if (url === 'mock:peerjs') {
        return {
          shortCircuit: true,
          format: 'module',
          source: `
            export class Peer {
              constructor(id, opts) { this.id = id; this.opts = opts; this.destroyed = false; }
              on() {}
              connect() { return { open: false, on() {}, send() {}, close() {} }; }
              destroy() { this.destroyed = true; }
            }
          `
        }
      }
      return nextLoad(url, context)
    }
  })
}

ensureEsmTestHooks()
