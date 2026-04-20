'use client'

import { createContext, useContext, useEffect, useSyncExternalStore, useCallback } from 'react'

type Theme = 'light' | 'dark'

const ThemeContext = createContext<{
  theme: Theme
  toggle: () => void
}>({
  theme: 'dark',
  toggle: () => {},
})

export function useTheme() {
  return useContext(ThemeContext)
}

function getSnapshot(): Theme {
  return (localStorage.getItem('mcr-theme') as Theme | null) ?? 'dark'
}

function getServerSnapshot(): Theme {
  return 'dark'
}

function subscribe(callback: () => void) {
  window.addEventListener('storage', callback)
  return () => window.removeEventListener('storage', callback)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggle = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('mcr-theme', next)
    document.documentElement.setAttribute('data-theme', next)
    // Trigger re-render via storage event for useSyncExternalStore
    window.dispatchEvent(new StorageEvent('storage', { key: 'mcr-theme', newValue: next }))
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>
      {children}
    </ThemeContext.Provider>
  )
}
