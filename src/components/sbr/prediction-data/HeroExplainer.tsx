'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { RISK_BAND_LABELS, bandForRejectedNeighbours } from '@/lib/sbr/riskBands'
import styles from './PredictionData.module.css'
import { IconNext, IconPrev, IconShield, PlayPauseIcon, Shape, revealClass, useReveal } from './shared'

/**
 * "How predictions use this data", the page's hero (design: Claude Design,
 * 13 Oct 2026). A map of past cases on a dot grid; a new client arrives, is
 * joined to its 8 nearest, and the result card appears; then new cases fill
 * the gaps and the matches get closer. Four steps, playing by themselves once
 * the hero is on screen (never under reduced motion); staff can pause, step
 * back and forth, or pick a step.
 *
 * The dots are synthetic: fixed positions from a seeded generator. Exactly 2
 * of the client's 8 nearest are rejected, so the card reads Borderline under
 * the default band rule, matching the text.
 */

const K = 8
const STEP_MS = 5200
const CLIENT = { x: 47, y: 52 }
const RECOMMENDED_CENTS = 39
/** Which of the 8 nearest (nearest first) had their plan accepted: 2 rejected. */
const NEAREST_ACCEPTED = [true, false, true, true, false, true, true, true]

interface Pt {
  k: number
  x: number
  y: number
  accepted: boolean
  extra: boolean
}

function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const dist = (p: { x: number; y: number }) => Math.hypot(p.x - CLIENT.x, p.y - CLIENT.y)

/** The synthetic map: 58 past cases, 12 more that "arrive", and the client's nearest 8 before and after. */
export function buildMap() {
  const h = seeded(5)
  const g = () => h() + h() + h() - 1.5
  const cloud: Pt[] = []
  for (let k = 0; k < 58; k++) {
    const accepted = h() < 0.77
    cloud.push({
      k,
      accepted,
      extra: false,
      x: Math.max(4, Math.min(96, (accepted ? 63 : 34) + g() * 40)),
      y: Math.max(4, Math.min(96, (accepted ? 38 : 64) + g() * 46)),
    })
  }
  const nearBase = [...cloud].sort((a, b) => dist(a) - dist(b)).slice(0, K)
  nearBase.forEach((p, j) => {
    p.accepted = NEAREST_ACCEPTED[j]
  })
  const extra: Pt[] = []
  for (let k = 0; k < 12; k++) {
    const a = h() * Math.PI * 2
    const d = 3 + h() * 9
    extra.push({ k: 58 + k, extra: true, accepted: h() < 0.6, x: CLIENT.x + Math.cos(a) * d, y: CLIENT.y + Math.sin(a) * d * 1.3 })
  }
  const nearAll = [...cloud, ...extra].sort((a, b) => dist(a) - dist(b)).slice(0, K)
  const avg = (ps: Pt[]) => ps.reduce((s, p) => s + dist(p), 0) / ps.length
  const closer = Math.round((1 - avg(nearAll) / avg(nearBase)) * 100)
  return { cloud, extra, nearBase, nearAll, closer }
}

interface Props {
  total: number
  accepted: number
  rejected: number
  accuracy: number | null
  /** A dialog is open: hold the autoplay. */
  hold: boolean
}

export function HeroExplainer({ total, accepted, rejected, accuracy, hold }: Props) {
  const map = useMemo(() => buildMap(), [])
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [ref, seen] = useReveal<HTMLElement>()
  const started = useRef(false)

  // Start playing the first time the hero is on screen, unless reduced motion.
  useEffect(() => {
    if (!seen || started.current) return
    started.current = true
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => setPlaying(true), 400)
    return () => clearTimeout(t)
  }, [seen])

  useEffect(() => {
    if (!playing || hold) return
    const t = setTimeout(() => setStep((s) => (s + 1) % 4), STEP_MS)
    return () => clearTimeout(t)
  }, [playing, hold, step])

  const go = (n: number) => {
    setPlaying(false)
    setStep(((n % 4) + 4) % 4)
  }

  const near = step >= 3 ? map.nearAll : map.nearBase
  const nearSet = new Set(near.map((p) => p.k))
  const band = RISK_BAND_LABELS[bandForRejectedNeighbours(NEAREST_ACCEPTED.filter((a) => !a).length)]
  const shownNear = step >= 3 ? map.nearAll : map.nearBase
  const nearRejected = shownNear.filter((p) => !p.accepted).length

  const captions = [
    `${map.cloud.length} past SBRs, placed by similarity`,
    `New client matched with its ${K} nearest`,
    `${nearRejected} of the ${K} plans rejected: ${band}`,
    '+12 new cases fill the gaps',
  ]
  const stepDefs = [
    {
      title: 'Every past SBR becomes a data point',
      body: `Each of the ${total} finished restructurings (${accepted} plans accepted, ${rejected} rejected) is placed on a map using seven facts: whether a DPN was issued, upfront or payment plan, a director loan and its amount, total days late, late lodgements and days since the last payment. Similar businesses land close together.`,
    },
    {
      title: `A new client is matched with the ${K} most similar`,
      body: `When you assess a new client, we place them on the same map and find the ${K} past cases closest to them. Closeness is measured across all seven facts at once, not just one.`,
    },
    {
      title: 'Their outcomes become the prediction',
      body: `The recommended offer is the average cents in the dollar those ${K} offered. How many of them had their plan rejected sets the risk band (indicative). Here 2 of the ${K} were rejected: ${band}.`,
    },
    {
      title: 'Every upload makes matches closer',
      body: `Each case you add fills a gap on the map, so future clients find closer neighbours. In this example the ${K} matches sit ${map.closer}% closer once new cases arrive, so the prediction is steadier.${
        accuracy !== null ? ` Today a prediction is typically within ±${accuracy} points.` : ''
      }`,
    },
  ]

  const linesD = near.map((p) => `M${CLIENT.x} ${CLIENT.y} L${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')

  return (
    <section
      ref={ref}
      aria-labelledby="how-title"
      className={`${styles.card} ${revealClass(seen)}`}
      style={{ padding: 36, display: 'flex', flexDirection: 'column', gap: 28 }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className={styles.eyebrow} style={{ color: 'var(--faint)' }}>
            The idea in 4 steps
          </div>
          <h2 id="how-title" style={{ margin: 0, fontSize: 30, lineHeight: 1.1 }}>
            How predictions use this data
          </h2>
        </div>
        <div className={styles.num} style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 600 }}>
          Step {step + 1} of 4
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 40, alignItems: 'stretch' }}>
        {/* Illustration */}
        <div
          className={styles.dotgrid}
          role="img"
          aria-label={`Diagram, step ${step + 1}: ${captions[step]}`}
          style={{ flex: '1.25 1 480px', minWidth: 0, position: 'relative', height: 440, borderRadius: 18, border: '1px solid var(--line2)', overflow: 'hidden' }}
        >
          <div
            style={{
              position: 'absolute',
              left: 18,
              top: 18,
              zIndex: 3,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 999,
              background: 'var(--card)',
              border: '1px solid var(--line2)',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--muted)',
              boxShadow: 'var(--shadow)',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />
            <span key={step} className={styles.rise}>
              {captions[step]}
            </span>
          </div>

          <div style={{ position: 'absolute', inset: '64px 28px 56px 28px' }}>
            {step >= 1 && (
              <svg
                key={step >= 3 ? 'after' : 'before'}
                className={styles.linesgrow}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', opacity: 0.8 }}
              >
                <path
                  className={styles.dash}
                  d={linesD}
                  fill="none"
                  stroke="#2563EB"
                  strokeWidth={1.6}
                  strokeDasharray="5 3"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            )}
            {[...map.cloud, ...map.extra].map((p, j) => {
              const isNear = step >= 1 && nearSet.has(p.k)
              const visible = !p.extra || step >= 3
              const colour = p.accepted ? 'var(--ok)' : 'var(--bad)'
              const style: CSSProperties = {
                position: 'absolute',
                left: `${p.x}%`,
                top: `${p.y}%`,
                width: 12,
                height: 12,
                margin: '-6px 0 0 -6px',
                borderRadius: p.accepted ? '50%' : 0,
                clipPath: p.accepted ? undefined : 'polygon(50% 0, 100% 100%, 0 100%)',
                background: colour,
                opacity: !visible ? 0 : step >= 1 && !isNear ? 0.26 : 1,
                transform: `scale(${!visible ? 0 : isNear ? 1.35 : 1})`,
                transition: 'opacity .6s ease, transform .6s cubic-bezier(.2,.8,.2,1.3)',
                animationDelay: `${j * 16}ms`,
                zIndex: isNear ? 2 : 1,
              }
              return <span key={p.k} className={p.extra ? undefined : styles.pop} style={style} />
            })}
            <div
              style={{
                position: 'absolute',
                left: `${CLIENT.x}%`,
                top: `${CLIENT.y}%`,
                width: 20,
                height: 20,
                margin: '-10px 0 0 -10px',
                zIndex: 4,
                transition: 'opacity .5s ease, transform .5s cubic-bezier(.2,.8,.2,1.3)',
                opacity: step >= 1 ? 1 : 0,
                transform: `scale(${step >= 1 ? 1 : 0.2})`,
              }}
            >
              {step >= 1 && (
                <>
                  <span className={styles.ripple} />
                  <span className={`${styles.ripple} ${styles.ripple2}`} />
                </>
              )}
              <span className={styles.ring} style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#2563EB' }} />
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: '50%',
                  background: '#2563EB',
                  boxShadow: '0 0 0 3px var(--card2), 0 6px 16px -4px rgba(37,99,235,.7)',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: 26,
                  top: -4,
                  whiteSpace: 'nowrap',
                  padding: '4px 9px',
                  borderRadius: 8,
                  background: '#2563EB',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                New client
              </span>
            </div>
          </div>

          {/* Result card */}
          <div
            style={{
              position: 'absolute',
              right: 18,
              top: 18,
              zIndex: 5,
              width: 250,
              padding: '16px 18px',
              borderRadius: 16,
              background: 'var(--card)',
              border: '1px solid var(--line2)',
              boxShadow: 'var(--shadow-lg)',
              transition: 'opacity .5s ease, transform .5s cubic-bezier(.2,.8,.2,1)',
              opacity: step >= 2 ? 1 : 0,
              transform: `translateY(${step >= 2 ? 0 : -10}px)`,
            }}
          >
            <div className={styles.eyebrow} style={{ fontSize: 12, letterSpacing: '.06em', color: 'var(--faint)' }}>
              Prediction · new client
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 10 }}>
              <div>
                <span className={`${styles.display} ${styles.num}`} style={{ fontSize: 38, fontWeight: 700, lineHeight: 1, letterSpacing: '-.03em' }}>
                  {RECOMMENDED_CENTS}c
                </span>
                <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>recommended offer</div>
              </div>
              <span style={{ padding: '4px 10px', borderRadius: 999, background: 'var(--warn-soft)', color: 'var(--warn-text)', fontSize: 12.5, fontWeight: 700 }}>
                {band}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 12 }} aria-hidden="true">
              {shownNear.map((p) => (
                <Shape key={p.k} accepted={p.accepted} size={9} />
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>
              {step >= 3
                ? `Same client, closer matches: the ${K} nearest now sit ${map.closer}% closer.`
                : `2 of the ${K} closest past cases had their plan rejected.`}
            </div>
          </div>

          {/* Legend */}
          <div
            style={{
              position: 'absolute',
              left: 18,
              bottom: 16,
              zIndex: 3,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 16,
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--muted)',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Shape accepted size={10} />
              Plan accepted
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Shape accepted={false} size={10} />
              Plan rejected
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#2563EB' }} />
              New client
            </span>
          </div>
        </div>

        {/* Stepper */}
        <div style={{ flex: '1 1 360px', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 24 }}>
          <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {stepDefs.map((sd, k) => {
              const active = k === step
              const done = k < step
              return (
                <li key={sd.title} style={{ display: 'flex', gap: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 6 }}>
                    <span
                      className={styles.num}
                      style={{
                        width: 30,
                        height: 30,
                        flex: 'none',
                        borderRadius: '50%',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 13,
                        fontWeight: 700,
                        transition: 'all .3s ease',
                        ...(active
                          ? { background: '#2563EB', color: '#fff', boxShadow: '0 0 0 5px var(--accent-soft)' }
                          : done
                            ? { background: 'var(--accent-soft)', color: 'var(--accent-text)' }
                            : { background: 'var(--card)', color: 'var(--faint)', border: '1.5px solid var(--line)' }),
                      }}
                    >
                      {k + 1}
                    </span>
                    {k < 3 && (
                      <span
                        style={{
                          flex: 1,
                          width: 2,
                          minHeight: 14,
                          marginTop: 6,
                          borderRadius: 2,
                          transition: 'background .3s ease',
                          background: done ? '#2563EB' : 'var(--line2)',
                        }}
                      />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, paddingBottom: 14 }}>
                    <h3 style={{ margin: 0, font: 'inherit', letterSpacing: 'normal' }}>
                      <button
                        type="button"
                        className={styles.stepbtn}
                        aria-expanded={active}
                        aria-current={active ? 'step' : undefined}
                        onClick={() => go(k)}
                        style={{ fontSize: 16.5, fontWeight: active ? 700 : 550, color: active ? 'var(--text)' : 'var(--muted)' }}
                      >
                        {sd.title}
                      </button>
                    </h3>
                    {active && (
                      <div className={styles.rise} style={{ padding: '2px 0 8px' }} aria-live="polite">
                        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6, color: 'var(--muted)' }}>{sd.body}</p>
                        {playing && !hold && (
                          <div style={{ height: 3, marginTop: 14, borderRadius: 3, background: 'var(--line2)', overflow: 'hidden' }}>
                            <div key={step} className={styles.grow} style={{ height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className={`${styles.btn} ${styles.iconBtn}`} aria-label="Previous step" onClick={() => go(step - 1)}>
              <IconPrev />
            </button>
            <button type="button" className={styles.btn} style={{ minWidth: 112 }} onClick={() => setPlaying((p) => !p)}>
              <PlayPauseIcon playing={playing} />
              {playing ? 'Pause' : 'Play'}
            </button>
            <button type="button" className={`${styles.btn} ${styles.iconBtn}`} aria-label="Next step" onClick={() => go(step + 1)}>
              <IconNext />
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '16px 20px',
          borderRadius: 14,
          background: 'var(--card2)',
          border: '1px solid var(--line2)',
        }}
      >
        <span
          style={{
            flex: 'none',
            width: 36,
            height: 36,
            borderRadius: 10,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--accent-soft)',
            color: 'var(--accent-text)',
          }}
        >
          <IconShield size={19} />
        </span>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--muted)' }}>
          <strong style={{ color: 'var(--text)' }}>No AI model guesses here.</strong> Every prediction comes straight from
          the real past cases on this page, worked out the same way every time, and you can open any of them.
        </p>
      </div>
    </section>
  )
}
