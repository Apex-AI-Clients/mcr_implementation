'use client'

import Link, { useLinkStatus } from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Spinner } from '@/components/ui/Spinner'
import { GAP, pageItems } from '@/lib/leads/pagination'

interface PaginationProps {
  page: number
  pageCount: number
  /** Where a page number points. Links, so a page is shareable and the back button works. */
  hrefFor: (page: number) => string
  /** "11–20 of 47". Sits opposite the control and is read out with it. */
  label?: string
}

/**
 * Page numbers with ellipses: 1 … 4 5 6 … 10.
 *
 * Two runs of numbers are rendered and the breakpoint picks one — wide gets a
 * neighbour either side of the current page, narrow gets the ends and the
 * current page alone. Doing it in CSS rather than by measuring means the
 * server and the client agree on the markup, so there is no hydration
 * mismatch and no flash of the wrong layout.
 *
 * Nothing renders for a single page. There is no navigating to do, and an
 * inert "1" only invites a click that does nothing.
 */
export function Pagination({ page, pageCount, hrefFor, label }: PaginationProps) {
  if (pageCount <= 1) return null

  const previous = page > 1 ? page - 1 : null
  const next = page < pageCount ? page + 1 : null

  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
    >
      {label ? (
        <p className="text-xs tabular-nums text-foreground/50">{label}</p>
      ) : (
        <span />
      )}

      <div className="flex items-center gap-1">
        <Step href={previous === null ? null : hrefFor(previous)} rel="prev" label="Previous page">
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Step>

        {/* Wide: a neighbour each side. */}
        <ol className="hidden items-center gap-1 sm:flex">
          {pageItems(page, pageCount, 1).map((item, index) => (
            <Slot key={`wide-${index}-${item}`} item={item} page={page} hrefFor={hrefFor} />
          ))}
        </ol>

        {/* Narrow: the ends and where you are. Prev/Next do the walking. */}
        <ol className="flex items-center gap-1 sm:hidden">
          {pageItems(page, pageCount, 0).map((item, index) => (
            <Slot key={`narrow-${index}-${item}`} item={item} page={page} hrefFor={hrefFor} />
          ))}
        </ol>

        <Step href={next === null ? null : hrefFor(next)} rel="next" label="Next page">
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Step>
      </div>
    </nav>
  )
}

const SLOT =
  'inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm tabular-nums transition-colors'

/**
 * What the link shows while its own navigation is in flight.
 *
 * useLinkStatus reports the pending state of the nearest enclosing Link, so it
 * has to be rendered inside one — which is exactly why this is a component
 * rather than a branch in Slot. A page read is a server round trip, and
 * without this a click on "3" looks like nothing happened until the rows
 * change underneath you.
 *
 * The spinner takes the slot the label had, so nothing on the row moves.
 */
function LinkContent({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus()
  if (!pending) return <>{children}</>
  // No label of its own: the enclosing link is already named "Page 3", and a
  // second announcement would just talk over it.
  return <Spinner size="sm" className="h-4 w-4" />
}

function Slot({
  item,
  page,
  hrefFor,
}: {
  item: number | typeof GAP
  page: number
  hrefFor: (page: number) => string
}) {
  if (item === GAP) {
    return (
      <li aria-hidden="true" className={`${SLOT} text-foreground/30`}>
        &hellip;
      </li>
    )
  }

  const current = item === page

  return (
    <li>
      <Link
        href={hrefFor(item)}
        aria-label={`Page ${item}`}
        // The assistive-tech equivalent of the highlight — without it the
        // current page is only distinguishable by colour.
        aria-current={current ? 'page' : undefined}
        className={
          current
            ? `${SLOT} bg-accent font-medium text-white`
            : `${SLOT} border border-border text-foreground/70 hover:bg-surface hover:text-foreground`
        }
      >
        <LinkContent>{item}</LinkContent>
      </Link>
    </li>
  )
}

/**
 * Previous / next. At either end this is a span rather than a disabled link:
 * there is nowhere to go, and a link to the page you are on is a trap for
 * anyone tabbing through.
 */
function Step({
  href,
  rel,
  label,
  children,
}: {
  href: string | null
  rel: 'prev' | 'next'
  label: string
  children: React.ReactNode
}) {
  if (href === null) {
    return (
      <span aria-hidden="true" className={`${SLOT} border border-border text-foreground/20`}>
        {children}
      </span>
    )
  }

  return (
    <Link
      href={href}
      rel={rel}
      aria-label={label}
      className={`${SLOT} border border-border text-foreground/70 hover:bg-surface hover:text-foreground`}
    >
      <LinkContent>{children}</LinkContent>
    </Link>
  )
}
