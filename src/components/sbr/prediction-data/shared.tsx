'use client'

import { useEffect, useRef, useState, type CSSProperties, type SVGProps } from 'react'
import styles from './PredictionData.module.css'

/**
 * Small pieces the Prediction Data page shares: the plan-accepted /
 * plan-rejected marks (a green circle and a red triangle, so they read
 * without colour too), its icons, and the scroll-reveal hook.
 */

export const money = (n: number) => `$${Math.round(n).toLocaleString('en-AU')}`
export const cents = (n: number) => `${n.toFixed(1)}c`

/** Plan accepted: circle. Plan rejected: triangle. */
export function Shape({ accepted, size = 9 }: { accepted: boolean; size?: number }) {
  const style: CSSProperties = accepted
    ? { width: size, height: size, borderRadius: '50%', background: 'var(--ok)', flex: 'none' }
    : {
        width: size + 1,
        height: size,
        background: 'var(--bad)',
        clipPath: 'polygon(50% 0, 100% 100%, 0 100%)',
        flex: 'none',
      }
  return <span aria-hidden="true" style={{ display: 'inline-block', ...style }} />
}

/** "Plan accepted" / "Plan rejected", the creditors' vote. */
export function ResultBadge({ accepted }: { accepted: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        padding: '5px 11px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        background: accepted ? 'var(--ok-soft)' : 'var(--bad-soft)',
        color: accepted ? 'var(--ok-text)' : 'var(--bad-text)',
      }}
    >
      <Shape accepted={accepted} size={8} />
      {accepted ? 'Plan accepted' : 'Plan rejected'}
    </span>
  )
}

export function Pill({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'bad' | 'accent' | 'muted'
  children: React.ReactNode
}) {
  const tones = {
    ok: { background: 'var(--ok-soft)', color: 'var(--ok-text)' },
    warn: { background: 'var(--warn-soft)', color: 'var(--warn-text)' },
    bad: { background: 'var(--bad-soft)', color: 'var(--bad-text)' },
    accent: { background: 'var(--accent-soft)', color: 'var(--accent-text)' },
    muted: { background: 'var(--card2)', color: 'var(--faint)', border: '1px solid var(--line2)' },
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '5px 11px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        ...tones[tone],
      }}
    >
      {children}
    </span>
  )
}

/**
 * True once the element has scrolled into view (and stays true). Sections use
 * it to slide in once; under reduced motion the CSS shows them regardless.
 */
export function useReveal<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      // No observer (old browser, tests): reveal on the next frame.
      const frame = requestAnimationFrame(() => setSeen(true))
      return () => cancelAnimationFrame(frame)
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [ref, seen]
}

/** The reveal classes for a section. */
export const revealClass = (seen: boolean) => `${styles.reveal}${seen ? ` ${styles.revealIn}` : ''}`

type IconProps = SVGProps<SVGSVGElement> & { size?: number }
const icon = (path: React.ReactNode, strokeWidth = 1.8) =>
  function Icon({ size = 18, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {path}
      </svg>
    )
  }

export const IconDownload = icon(<path d="M12 4v11M7 10l5 5 5-5M5 20h14" />)
export const IconUpload = icon(<path d="M12 15V4M7 9l5-5 5 5M5 20h14" />, 1.9)
export const IconInfo = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.6v.1" />
  </>,
)
export const IconPrev = icon(<path d="M15 6l-6 6 6 6" />, 2)
export const IconNext = icon(<path d="M9 6l6 6-6 6" />, 2)
export const IconShield = icon(
  <>
    <path d="M12 3l7 3v6c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </>,
)
export const IconSearch = icon(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4-4" />
  </>,
  1.9,
)
export const IconWarn = icon(
  <>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17v.1" />
  </>,
  2.2,
)
export const IconChevron = icon(<path d="M6 9l6 6 6-6" />, 2)
export const IconFile = icon(
  <>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
  </>,
)
export const IconUndo = icon(
  <>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </>,
  2,
)
export const IconCheck = icon(<path d="M5 12l5 5 9-10" />, 3)
export const IconArrow = icon(<path d="M5 12h14M13 6l6 6-6 6" />, 2)

export function PlayPauseIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 5v14l12-7z" />
    </svg>
  )
}
