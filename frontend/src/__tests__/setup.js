function createMemoryStorage() {
  const store = new Map()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key) {
      return store.has(String(key)) ? store.get(String(key)) : null
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key) {
      store.delete(String(key))
    },
    setItem(key, value) {
      store.set(String(key), String(value))
    }
  }
}

const localStorageMock = createMemoryStorage()
const sessionStorageMock = createMemoryStorage()

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
  writable: true
})
Object.defineProperty(globalThis, 'sessionStorage', {
  value: sessionStorageMock,
  configurable: true,
  writable: true
})
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    configurable: true,
    writable: true
  })
  Object.defineProperty(window, 'sessionStorage', {
    value: sessionStorageMock,
    configurable: true,
    writable: true
  })
}
