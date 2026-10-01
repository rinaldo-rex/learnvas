import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { parseThemePreference, resolveTheme, THEME_KEY } from './theme'

const QUERY = '(prefers-color-scheme: dark)'
const getSystemDark = () => window.matchMedia(QUERY).matches
function subscribeSystemTheme(onChange: () => void) {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function useTheme() {
  const [preference, setPreference] = useState(() => {
    try {
      return parseThemePreference(localStorage.getItem(THEME_KEY))
    } catch {
      return 'system' as const
    }
  })
  const systemDark = useSyncExternalStore(subscribeSystemTheme, getSystemDark)
  const theme = resolveTheme(preference, systemDark)

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }, [theme])

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, preference)
    } catch {
      // Theme switching still works when persistence is unavailable.
    }
  }, [preference])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_KEY || event.key === null) {
        setPreference(parseThemePreference(event.newValue))
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return { preference, theme, setPreference }
}
