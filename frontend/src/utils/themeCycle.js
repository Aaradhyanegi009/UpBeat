// UpBeat theme: dark only.
// The app no longer offers a light/dark switch. Colour that changes with the
// playing song's artwork is handled separately by colorExtractor.js.

const DARK_THEME = {
  id: 'theme-dark',
  label: 'Dark',
  timeSlot: 'Dark',
  type: 'dark',
  color: '#94a3b8',
  accentColor: '#ffffff',
  preference: 'dark'
}

export function getThemeInfo() {
  return DARK_THEME
}

export function applyThemeToDocument() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.remove('theme-morning', 'theme-afternoon', 'theme-night', 'theme-light')
  root.classList.add('dark', 'theme-dark')
  root.setAttribute('data-theme', 'dark')
  root.style.colorScheme = 'dark'
}

// Apply immediately on load to avoid a flash, and drop any old saved preference.
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('upbeat_theme_preference')
  } catch {}
  applyThemeToDocument()
}
