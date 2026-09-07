'use client'

import { useRef, useState } from 'react'

interface TooltipProps {
  /** Full text to reveal. Nothing renders when this is empty. */
  content: string
  children: React.ReactNode
  className?: string
}

/** Roughly the bubble's width, used to keep it inside the viewport. */
const BUBBLE_WIDTH = 320
const GAP = 8

/**
 * Hover/focus tooltip for text that has been truncated in place.
 *
 * Positioned `fixed` rather than `absolute` on purpose: the leads table sits in
 * a wrapper with `overflow-y-hidden` (which stops it growing a second vertical
 * scrollbar), and an absolutely positioned bubble inside that wrapper would be
 * clipped to the row. Fixed positioning escapes the clip, at the cost of having
 * to measure the trigger.
 *
 * Opens on focus as well as hover, so it is reachable from the keyboard.
 */
export function Tooltip({ content, children, className }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  function show() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return

    // Flip above the trigger when there isn't room beneath it.
    const below = window.innerHeight - rect.bottom
    const top = below < 120 ? rect.top - GAP : rect.bottom + GAP

    setPosition({
      top,
      // Clamp so a cell near the right edge doesn't push the bubble off screen.
      left: Math.min(Math.max(GAP, rect.left), window.innerWidth - BUBBLE_WIDTH - GAP),
    })
  }

  function hide() {
    setPosition(null)
  }

  if (!content) return <>{children}</>

  return (
    <span
      ref={triggerRef}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
    >
      {children}
      {position && (
        <span
          role="tooltip"
          style={{
            top: position.top,
            left: position.left,
            width: BUBBLE_WIDTH,
            transform: position.top < window.innerHeight / 2 ? undefined : 'translateY(-100%)',
          }}
          // break-words is load-bearing: whitespace-pre-wrap only wraps where
          // there is whitespace, so a long unbroken string ("fffff…") would
          // otherwise run straight out of the bubble.
          className="pointer-events-none fixed z-[70] max-h-80 overflow-hidden whitespace-pre-wrap break-words rounded-lg border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground shadow-xl"
        >
          {content}
        </span>
      )}
    </span>
  )
}
