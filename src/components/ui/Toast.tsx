'use client'

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, AlertTriangle } from 'lucide-react'

type ToastTone = 'success' | 'error'

export interface ToastOptions {
  tone?: ToastTone
  /** Optional follow-up destination, e.g. the client file just created. */
  href?: string
  linkLabel?: string
}

interface ToastItem extends ToastOptions {
  id: number
  message: string
  tone: ToastTone
}

interface ToastContextValue {
  /** Confirmation of something the user just did. Plain past tense. */
  toast: (message: string, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const DISMISS_AFTER_MS = 3200

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(0)

  const toast = useCallback((message: string, options: ToastOptions = {}) => {
    const id = nextId.current++
    setItems((prev) => [...prev, { ...options, id, message, tone: options.tone ?? 'success' }])
    setTimeout(() => {
      setItems((prev) => prev.filter((item) => item.id !== id))
    }, DISMISS_AFTER_MS)
  }, [])

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg ${
              item.tone === 'error'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-border bg-card text-foreground'
            }`}
          >
            {item.tone === 'error' ? (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
            )}
            <span>{item.message}</span>
            {item.href && (
              <Link
                href={item.href}
                className="ml-1 shrink-0 font-medium text-accent hover:underline"
              >
                {item.linkLabel ?? 'Open'}
              </Link>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside a ToastProvider')
  return context
}
