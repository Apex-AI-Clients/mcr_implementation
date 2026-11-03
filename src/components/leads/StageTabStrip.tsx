'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StageTabStripProps {
  /** Changes when another tab opens, so that tab is scrolled into view. */
  active: string
  /** The tabs. The one with aria-current="page" is the one kept in view. */
  children: React.ReactNode
  /** Sits at the end, outside the scroll, so it is always reachable. */
  trailing?: React.ReactNode
}

/**
 * The stage tabs, on one line however many there are. With 20 or 30 stages,
 * wrapping would push the table down by several rows and reorder tabs
 * depending on the window's width; one scrolling row keeps the table where it
 * is and each tab in the same place.
 *
 * Arrows appear at either end only when there is more that way, and the open
 * tab is scrolled into view, so one at the far end is never hidden.
 */
export function StageTabStrip({ active, children, trailing }: StageTabStripProps) {
  const scroller = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setMore((current) => (current.left === left && current.right === right ? current : { left, right }))
  }, [])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    // jsdom (tests) has neither.
    const tab = el.querySelector<HTMLElement>('[aria-current="page"]')
    if (tab && typeof tab.scrollIntoView === 'function') {
      tab.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(el)
    return () => observer.disconnect()
  }, [active, measure])

  function nudge(direction: -1 | 1) {
    const el = scroller.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  const arrow = 'absolute top-0 bottom-px z-10 flex w-8 cursor-pointer items-center justify-center text-foreground/60 hover:text-foreground'

  return (
    <div className="-mt-2 mb-4 flex items-stretch border-b border-border">
      <div className="relative min-w-0 flex-1">
        {more.left && (
          <button
            type="button"
            aria-label="Earlier stages"
            onClick={() => nudge(-1)}
            className={cn(arrow, 'left-0 bg-linear-to-r from-primary via-primary to-transparent')}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <div
          ref={scroller}
          onScroll={measure}
          className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {children}
        </div>
        {more.right && (
          <button
            type="button"
            aria-label="More stages"
            onClick={() => nudge(1)}
            className={cn(arrow, 'right-0 bg-linear-to-l from-primary via-primary to-transparent')}
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {trailing && <div className="flex shrink-0 items-stretch">{trailing}</div>}
    </div>
  )
}
