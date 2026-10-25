// UpBeat Dynamic Day/Night Cycle Theme Engine
// - Morning (4:00 AM - 11:59 AM): Crimson Sunrise (The signature red grid aesthetic)
// - Afternoon / Sunset (12:00 PM - 7:59 PM): Dark AMOLED Black (Zero gradients, 100% black)
// - Night (8:00 PM - 3:59 AM): Cosmic Midnight Violet & Neon Indigo

// Ensure root is always dark and any legacy light mode storage is purged
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('upbeat_theme_mode')
    if (document.documentElement) {
      document.documentElement.classList.remove('theme-light')
      document.documentElement.classList.add('dark')
    }
  } catch {}
}

export const THEME_OPTIONS = [
  { id: 'auto', label: 'Auto' },
  { id: 'amoled', label: 'Dark' },
  { id: 'morning', label: 'Crimson Glow' },
  { id: 'night', label: 'Violet' }
]

export function getNextThemePreference(current = 'auto') {
  const order = ['auto', 'amoled', 'morning', 'night']
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
  } else if (hour >= 12 && hour < 20) {
    return {
      id: 'theme-afternoon',
      label: 'Dark',
      timeSlot: 'Afternoon (12 PM – 8 PM)',
      type: 'afternoon',
      color: '#71717a',
      accentColor: '#ffffff'
    }
  } else {
    return {
      id: 'theme-night',
      label: 'Violet',
      timeSlot: 'Night (8 PM – 4 AM)',
      type: 'night',
      color: '#8b5cf6',
      accentColor: '#6366f1'
    }
  }
}

export function getThemeInfo(preference = 'auto') {
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
  if (preference === 'night') {
    return {
      id: 'theme-night',
      label: 'Violet',
      timeSlot: 'Violet',
      type: 'night',
      color: '#8b5cf6',
      accentColor: '#6366f1',
      preference: 'night'
    }
  }
  return {
    ...getDayNightThemeInfo(),
    preference: 'auto'
  }
}
