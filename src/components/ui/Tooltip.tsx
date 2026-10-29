'use client'

import { useEffect, useRef, useState } from 'react'

interface TooltipProps {
  /** Full text to reveal. Nothing renders when this is empty. */
  content: React.ReactNode
  children: React.ReactNode
  className?: string
  /** The bubble's height cap; max-h-80 unless the content needs more room. */
  maxHeightClassName?: string
  /**
   * The bubble takes the pointer, for content with a control in it (a copy
   * button). It stays open while the pointer crosses the gap into it, and a
   * click inside it does not reach the row beneath. Scrolls when taller than
   * its height cap, since the pointer can reach it.
   */
  interactive?: boolean
}

/** Roughly the bubble's width, used to keep it inside the viewport. */
const BUBBLE_WIDTH = 320
const GAP = 8
/** Long enough to cross GAP into an interactive bubble before it closes. */
const HIDE_DELAY_MS = 150

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
export function Tooltip({
  content,
  children,
  className,
  maxHeightClassName = 'max-h-80',
  interactive = false,
}: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  function cancelHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = null
  }

  useEffect(() => cancelHide, [])

  function show() {
    cancelHide()
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
    cancelHide()
    setPosition(null)
  }

  // The bubble sits inside the trigger, so pointer and focus moving into it
  // never count as leaving; only the GAP between them needs the delay.
  function hideOnLeave() {
    if (!interactive) return hide()
    cancelHide()
    hideTimer.current = setTimeout(hide, HIDE_DELAY_MS)
  }

  function hideOnBlur(event: React.FocusEvent) {
    if (event.relatedTarget instanceof Node && triggerRef.current?.contains(event.relatedTarget)) return
    hide()
  }

  if (!content) return <>{children}</>

  return (
    <span
      ref={triggerRef}
      className={className}
      onMouseEnter={show}
      onMouseLeave={hideOnLeave}
      onFocus={show}
      onBlur={hideOnBlur}
      tabIndex={0}
    >
      {children}
      {position && (
        <span
          role="tooltip"
          onClick={interactive ? (event) => event.stopPropagation() : undefined}
          style={{
            top: position.top,
            left: position.left,
            width: BUBBLE_WIDTH,
            transform: position.top < window.innerHeight / 2 ? undefined : 'translateY(-100%)',
          }}
          // break-words is load-bearing: whitespace-pre-wrap only wraps where
          // there is whitespace, so a long unbroken string ("fffff…") would
          // otherwise run straight out of the bubble.
          className={`${interactive ? 'pointer-events-auto cursor-auto' : 'pointer-events-none'} fixed z-[70] ${maxHeightClassName} ${interactive ? 'overflow-y-auto' : 'overflow-hidden'} whitespace-pre-wrap break-words rounded-lg border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground shadow-xl`}
        >
          {content}
        </span>
      )}
    </span>
  )
}
