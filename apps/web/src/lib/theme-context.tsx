import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ThemeContext, type Theme } from './theme-context-value'

const STORAGE_KEY = 'atomicqueue.theme'

function getInitialTheme(): Theme {
  if (typeof document === 'undefined') return 'light'
  // The inline script in index.html already applied the right class
  // before paint — just read it back so React's state agrees.
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* localStorage blocked (private mode, etc.) — theme just won't persist */
  }
}

/**
 * Wraps the app so any page can read/toggle the theme. Persists to
 * localStorage; falls back to the OS preference on first visit (see
 * the pre-paint script in index.html, which this reads back on mount).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === 'dark' ? 'light' : 'dark'))
  }, [])

  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
