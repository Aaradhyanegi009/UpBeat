// UpBeat Minimalist Dark & Light Theme Engine
// - Dark: Pure AMOLED obsidian black with dynamic playing song ambient aura
// - Light: High-contrast clean studio alabaster aesthetic

export const THEME_OPTIONS = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' }
]

export function getNextThemePreference(current = 'dark') {
  return current === 'light' ? 'dark' : 'light'
}

export function getDayNightThemeInfo() {
  return getThemeInfo('dark')
}

export function getThemeInfo(preference = 'dark') {
  if (preference === 'light') {
    return {
      id: 'theme-light',
      label: 'Light',
      timeSlot: 'Light',
      type: 'light',
      color: '#f59e0b',
      accentColor: '#e11d48',
      preference: 'light'
    }
  }
  return {
    id: 'theme-dark',
    label: 'Dark',
    timeSlot: 'Dark',
    type: 'dark',
    color: '#94a3b8',
    accentColor: '#ffffff',
    preference: 'dark'
  }
}

export function applyThemeToDocument(preference, themeInfo) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.remove('theme-morning', 'theme-afternoon', 'theme-night', 'theme-light', 'dark', 'theme-dark')
  const isLight = preference === 'light' || themeInfo?.type === 'light'

  if (isLight) {
    root.classList.add('theme-light')
    root.setAttribute('data-theme', 'light')
    root.style.colorScheme = 'light'
  } else {
    root.classList.add('dark', 'theme-dark')
    root.setAttribute('data-theme', 'dark')
    root.style.colorScheme = 'dark'
  }
}

// Immediate execution on load to prevent any theme flash
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem('upbeat_theme_preference')
    const pref = saved === 'light' ? 'light' : 'dark'
    applyThemeToDocument(pref, getThemeInfo(pref))
  } catch {}
}
