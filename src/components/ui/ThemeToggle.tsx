'use client'

import { useTheme } from '@/components/ThemeProvider'
import { Sun, Moon } from 'lucide-react'

interface ThemeToggleProps {
  className?: string
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggle } = useTheme()

  return (
    <button
      onClick={toggle}
      className={`relative h-8 w-14 rounded-full border border-border bg-input-bg p-0.5 transition-colors hover:border-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${className ?? ''}`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full bg-accent shadow-md transition-transform duration-200 ${
          theme === 'light' ? 'translate-x-6' : 'translate-x-0'
        }`}
      >
        {theme === 'dark' ? (
          <Moon className="h-3.5 w-3.5 text-white" />
        ) : (
          <Sun className="h-3.5 w-3.5 text-white" />
        )}
      </span>
    </button>
  )
}
