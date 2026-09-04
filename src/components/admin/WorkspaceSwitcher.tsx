'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronsUpDown } from 'lucide-react'
import { WORKSPACES, type Workspace } from '@/lib/workspaces'

interface WorkspaceSwitcherProps {
  current: Workspace
  /** 'sidebar' sits under the MCR logo; 'bar' is a pill for the top bar. */
  variant?: 'sidebar' | 'bar'
}

/**
 * Crossing between workspaces shouldn't mean navigating back to the chooser.
 * In the sidebar it replaces the old static "Admin Panel" subtitle; in the top
 * bar it stands on its own as a pill.
 */
export function WorkspaceSwitcher({ current, variant = 'sidebar' }: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          variant === 'bar'
            ? 'flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent'
            : '-ml-1 mt-0.5 flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted transition-colors hover:text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-accent'
        }
      >
        {current.name}
        <ChevronsUpDown className="h-3 w-3" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Switch workspace"
          className="absolute left-0 top-full z-20 mt-1.5 w-44 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          {WORKSPACES.map((workspace) => {
            const Icon = workspace.icon
            const isCurrent = workspace.id === current.id
            return (
              <Link
                key={workspace.id}
                href={workspace.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted transition-colors hover:bg-surface hover:text-foreground"
              >
                <span className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  {workspace.name}
                </span>
                {isCurrent && <Check className="h-3.5 w-3.5 text-accent" />}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
