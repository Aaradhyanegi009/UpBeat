// UpBeat Minimalist Night & Day Theme Engine
// - Night Mode: Deep AMOLED obsidian backdrop with crystalline atmospheric blur
// - Daylight Mode: High-contrast clean studio alabaster aesthetic

export const THEME_OPTIONS = [
  { id: 'amoled', label: 'Night' },
  { id: 'light', label: 'Day' }
]

export function getNextThemePreference(current = 'amoled') {
  return current === 'light' ? 'amoled' : 'light'
}

export function getDayNightThemeInfo() {
  return getThemeInfo('amoled')
}

export function getThemeInfo(preference = 'amoled') {
  if (preference === 'light') {
    return {
      id: 'theme-light',
      label: 'Daylight',
      timeSlot: 'Day Mode',
      type: 'light',
      color: '#f59e0b',
      accentColor: '#e11d48',
      preference: 'light'
    }
  }
  return {
    id: 'theme-afternoon',
    label: 'Night',
    timeSlot: 'Night Mode',
    type: 'afternoon',
    color: '#818cf8',
    accentColor: '#ffffff',
    preference: 'amoled'
  }
}

export function applyThemeToDocument(preference, themeInfo) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.remove('theme-morning', 'theme-afternoon', 'theme-night', 'theme-light', 'dark')
  const info = themeInfo || getThemeInfo(preference)

  if (info.type === 'light' || preference === 'light') {
    root.classList.add('theme-light')
    root.setAttribute('data-theme', 'light')
    root.style.colorScheme = 'light'
  } else {
    root.classList.add('dark', 'theme-afternoon')
    root.setAttribute('data-theme', 'dark')
    root.style.colorScheme = 'dark'
  }
}

// Immediate execution on load to prevent any theme flash
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem('upbeat_theme_preference')
    const pref = saved === 'light' ? 'light' : 'amoled'
    applyThemeToDocument(pref, getThemeInfo(pref))
  } catch {}
}
