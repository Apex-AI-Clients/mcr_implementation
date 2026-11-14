'use client'

import { useRouter } from 'next/navigation'

/**
 * A link to a section of the dashboard that works every time it is clicked.
 *
 * A plain `#follow-ups` link does nothing the second time: the URL already
 * holds that hash, so the browser (and Next) sees no change, while the user
 * has scrolled away since. Here, when the section is on the page we scroll to
 * it directly and leave the URL alone; when it is not (another dashboard is
 * showing) we go to `href`, which opens that dashboard at the section.
 */
export function ScrollLink({
  target,
  href,
  className,
  children,
}: {
  /** The section's element id. */
  target: string
  /** Where to go when the section is not on this page, e.g. "/?view=leads#follow-ups". */
  href: string
  className?: string
  children: React.ReactNode
}) {
  const router = useRouter()
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        // Let a new tab / window open as usual.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        const el = document.getElementById(target)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
          return
        }
        router.push(href)
      }}
    >
      {children}
    </a>
  )
}
