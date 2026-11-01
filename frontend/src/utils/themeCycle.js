// UpBeat Dynamic Day/Night Cycle & Studio Theme Engine
// - Morning (4:00 AM - 11:59 AM): Crimson Sunrise (The signature red grid aesthetic)
// - Afternoon / Night (12:00 PM - 3:59 AM): Dark AMOLED Black (Zero gradients, 100% black)
// - Light (Daylight Studio): High-contrast clean alabaster studio aesthetic

export const THEME_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'amoled', label: 'Dark' },
  { id: 'morning', label: 'Crimson Glow' },
  { id: 'light', label: 'Light' }
]

export function getNextThemePreference(current = 'auto') {
  const order = ['auto', 'amoled', 'morning', 'light']
  const idx = order.indexOf(current)
  return order[(idx + 1) % order.length]
}

export function getDayNightThemeInfo() {
  const hour = new Date().getHours() // 0 - 23

  if (hour >= 4 && hour < 12) {
    return {
      id: 'theme-morning',
      label: 'Crimson Glow',
      timeSlot: 'Morning (4 AM – 12 PM)',
      type: 'morning',
      color: '#ef4444',
      accentColor: '#f43f5e'
    }
  } else {
    return {
      id: 'theme-afternoon',
      label: 'Dark',
      timeSlot: 'Dark AMOLED',
      type: 'afternoon',
      color: '#71717a',
      accentColor: '#ffffff'
    }
  }
}

export function getThemeInfo(preference = 'auto') {
  if (preference === 'light') {
    return {
      id: 'theme-light',
      label: 'Light',
      timeSlot: 'Daylight Studio',
      type: 'light',
      color: '#e11d48',
      accentColor: '#e11d48',
      preference: 'light'
    }
  }
  if (preference === 'amoled') {
    return {
      id: 'theme-afternoon',
      label: 'Dark',
      timeSlot: 'Dark',
      type: 'afternoon',
      color: '#71717a',
      accentColor: '#ffffff',
      preference: 'amoled'
    }
  }
  if (preference === 'morning') {
    return {
      id: 'theme-morning',
      label: 'Crimson Glow',
      timeSlot: 'Crimson Glow',
      type: 'morning',
      color: '#ef4444',
      accentColor: '#f43f5e',
      preference: 'morning'
    }
  }
  return {
    ...getDayNightThemeInfo(),
    preference: 'auto'
  }
}

export function applyThemeToDocument(preference, themeInfo) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.remove('theme-morning', 'theme-afternoon', 'theme-night', 'theme-light', 'dark')
  const activePref = preference || 'auto'
  const info = themeInfo || getThemeInfo(activePref)

  if (info.id === 'theme-light') {
    root.classList.add('theme-light')
    root.setAttribute('data-theme', 'light')
    root.style.colorScheme = 'light'
  } else {
    root.classList.add('dark', info.id)
    root.setAttribute('data-theme', 'dark')
    root.style.colorScheme = 'dark'
  }
}

// Immediate execution on load to prevent any theme flash
if (typeof window !== 'undefined') {
  try {
    const saved = localStorage.getItem('upbeat_theme_preference') || 'auto'
    applyThemeToDocument(saved, getThemeInfo(saved))
  } catch {}
}
