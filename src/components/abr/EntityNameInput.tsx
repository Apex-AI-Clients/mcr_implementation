'use client'

import { useEffect, useRef, useState } from 'react'
import { Building2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'
import { abrConfigured, lookupAbn, lookupAcns, searchAbr } from '@/lib/abr/browser'
import { prefillFromAbr } from '@/lib/abr/prefill'
import { tidyRegisterName } from '@/lib/abr/names'
import {
  abnStatusLabel,
  type AbrEntityDetails,
  type AbrNameMatch,
  type AbrPrefill,
} from '@/lib/abr/types'

/**
 * A name field that searches the Australian Business Register as you type.
 *
 * Not a lookup mode you enter and leave — it is the ordinary company/trust name
 * field, which happens to offer matches once there is enough to go on. Typing a
 * name and ignoring every suggestion is a complete, supported way to use it,
 * and is exactly what happens when the register is down or the deployment has
 * no ABR registration at all: it renders as the plain Input it wraps, and the
 * form around it behaves as it always did.
 *
 * Used wherever a company or trust is named — lead conversion, client creation
 * and the intake wizard's company step. It knows nothing about any of them: it
 * hands back an AbrPrefill and each form decides what to do with it.
 *
 * Picking a match fills fields; it never locks them. ABR is frequently stale
 * for the distressed companies this practice deals with, and the registered
 * name is routinely not the trading name on the invoices, so everything it
 * writes stays typed over.
 */

interface EntityNameInputProps {
  id: string
  label: string
  value: string
  error?: string
  disabled: boolean
  /** Passed straight through — the field this wraps is an ordinary input. */
  required?: boolean
  onChange: (value: string) => void
  /** Fields the picked register entity can fill. Applied by the parent form. */
  onPick: (prefill: AbrPrefill) => void
}

const DEBOUNCE_MS = 500
const MIN_TERM_LENGTH = 3

/**
 * Said plainly, because a blank dropdown reads like a dead end and it is not
 * one: the register is a convenience, and a company it has never heard of is
 * entered the way every company was entered before this field could search.
 */
const NO_MATCHES = 'Nothing on the register matches. Type the details in yourself.'

/**
 * A finished search, tagged with the term it answers.
 *
 * Tagged rather than merely stored, so a slow answer to an old term cannot land
 * on a newer one: what renders is the outcome whose term is the one in the box
 * right now, and anything else is simply not shown. That also keeps the effect
 * free of synchronous setState — a stale outcome stops matching on its own,
 * so nothing has to be cleared when the term changes.
 */
interface SearchOutcome {
  term: string
  matches: AbrNameMatch[]
  notice: string
}

export function EntityNameInput({
  id,
  label,
  value,
  error,
  disabled,
  required,
  onChange,
  onPick,
}: EntityNameInputProps) {
  const [available, setAvailable] = useState(false)
  /**
   * What the person typed, which is not the same as what is in the field: a
   * pick writes the field and clears this, so filling a value never sets off a
   * search for the value just filled.
   */
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null)
  /** The term a request is in flight for, or null. */
  const [loadingTerm, setLoadingTerm] = useState<string | null>(null)
  const [pickingAbn, setPickingAbn] = useState<string | null>(null)
  const [pickError, setPickError] = useState('')
  /** Survives the list closing — see StatusNotice. */
  const [picked, setPicked] = useState<AbrEntityDetails | null>(null)
  /**
   * ACN by ABN, filled in behind the matches (the name search does not carry
   * them). Kept across searches: an ACN does not change between keystrokes.
   * '' means the register has none.
   */
  const [acns, setAcns] = useState<Record<string, string>>({})
  /**
   * ABNs whose ACN lookup has finished without an ACN coming back for them —
   * the batch failed, or the register did not answer for that one in time. An
   * ABN in neither this nor `acns` is still being looked up, and its row says
   * so, rather than looking as though it has no ACN.
   */
  const [acnSettled, setAcnSettled] = useState<ReadonlySet<string>>(() => new Set())

  const inFlight = useRef<AbortController | null>(null)

  useEffect(() => {
    let live = true
    void abrConfigured().then((configured) => {
      if (live) setAvailable(configured)
    })
    return () => {
      live = false
    }
  }, [])

  const term = query.trim()
  const ready = term.length >= MIN_TERM_LENGTH

  // Debounced search. The cleanup cancels both the pending timer and any
  // request already away, so each keystroke supersedes the one before it.
  useEffect(() => {
    if (!available || !ready) return

    const timer = setTimeout(() => {
      const controller = new AbortController()
      inFlight.current = controller
      setLoadingTerm(term)

      void searchAbr(term, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return
          // Whatever happened, the field is left exactly as typed. This is the
          // whole of the failure handling: one quiet line where the matches
          // would have been, and a form that still works by hand.
          setOutcome(
            result.kind === 'failed'
              ? { term, matches: [], notice: result.message }
              : {
                  term,
                  matches: result.matches,
                  // Deliberately ours rather than the register's own wording.
                  // ABR answers an empty search with "No matching names found",
                  // which is a full stop; what somebody needs to be told here is
                  // that they can carry on without it.
                  notice: result.matches.length === 0 ? NO_MATCHES : '',
                },
          )
        })
        .catch(() => {
          // Aborted — a newer keystroke owns the box now.
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoadingTerm(null)
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      inFlight.current?.abort()
    }
  }, [term, ready, available])

  const searching = available && ready && loadingTerm === term
  const shown = outcome && outcome.term === term ? outcome : null
  const matches = shown?.matches ?? []

  // Fetch the ACNs for the rows on screen that are not known yet. Keyed on the
  // outcome, so it runs once per finished search, and aborted when a newer
  // search replaces it.
  useEffect(() => {
    if (!outcome || outcome.matches.length === 0) return
    const missing = [...new Set(outcome.matches.map((match) => match.abn))].filter(
      (abn) => !(abn in acns),
    )
    if (missing.length === 0) return

    const controller = new AbortController()
    void lookupAcns(missing, controller.signal).then((found) => {
      if (controller.signal.aborted) return
      if (found) setAcns((current) => ({ ...current, ...found }))
      // Whatever did not come back is done too: stop showing it as loading.
      const unanswered = missing.filter((abn) => !found || !(abn in found))
      if (unanswered.length > 0) {
        setAcnSettled((current) => new Set([...current, ...unanswered]))
      }
    })
    return () => controller.abort()
    // `acns` deliberately left out: it only ever grows, from this effect, and
    // re-running on that would re-ask for whatever the register did not answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome])
  const notice = pickError || (searching ? '' : (shown?.notice ?? ''))
  const listOpen = available && focused && ready && (searching || shown !== null || pickError !== '')
  const activeIndex = matches.length > 0 ? Math.min(highlight, matches.length - 1) : -1
  const listId = `${id}-abr-matches`

  function handleChange(next: string) {
    onChange(next)
    setQuery(next)
    setHighlight(-1)
    // A failed pick belongs to the result that was picked, not to what is being
    // typed now.
    setPickError('')
  }

  async function pick(match: AbrNameMatch) {
    setPickingAbn(match.abn)
    setPickError('')
    const result = await lookupAbn(match.abn)
    setPickingAbn(null)

    if (result.kind === 'failed') {
      setPickError(result.message)
      return
    }

    onPick(prefillFromAbr(result.details))
    setPicked(result.details)
    // Closes the list without a flag: with nothing typed there is nothing to
    // search for, and the field now holds the register's answer.
    setQuery('')
    setHighlight(-1)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!listOpen) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (matches.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      const from = activeIndex < 0 ? (step === 1 ? -1 : 0) : activeIndex
      setHighlight((from + step + matches.length) % matches.length)
      return
    }

    if (event.key === 'Enter') {
      // Never let Enter submit the surrounding form while a list of matches is
      // open — saving is the last thing somebody browsing results is asking for.
      event.preventDefault()
      if (activeIndex >= 0 && !pickingAbn) void pick(matches[activeIndex])
    }
  }

  const field = (
    <Input
      id={id}
      label={label}
      value={value}
      error={error}
      disabled={disabled}
      required={required}
      onChange={(event) => handleChange(event.target.value)}
      onKeyDown={available ? handleKeyDown : undefined}
      autoComplete="off"
      {...(available
        ? {
            role: 'combobox',
            'aria-expanded': listOpen,
            'aria-controls': listId,
            'aria-autocomplete': 'list' as const,
            'aria-activedescendant':
              activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined,
          }
        : {})}
    />
  )

  // The wrapper is unconditional, and deliberately so. Whether the register is
  // available is only known once the status probe answers, and swapping the
  // tree at that moment would remount the input underneath somebody who had
  // already started typing — losing their focus and the characters in flight.
  // With no registration this is two empty divs around the field, and the
  // field is exactly the one the form had before any of this existed.
  return (
    <div className="space-y-2">
      <div
        className="relative"
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
        }}
      >
        {field}

        {listOpen && (
          <div
            // Keeps focus in the field, so clicking a match never closes the
            // list out from under the click.
            onMouseDown={(event) => event.preventDefault()}
            className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
          >
            {searching && (
              <p className="flex items-center gap-2 px-3 py-2.5 text-xs text-foreground/40">
                <Spinner size="sm" className="h-3.5 w-3.5" />
                Searching the register…
              </p>
            )}

            {!searching && notice && (
              <p className="px-3 py-2.5 text-xs text-foreground/50">{notice}</p>
            )}

            {matches.length > 0 && (
              <ul id={listId} role="listbox" className="max-h-60 overflow-y-auto">
                {matches.map((match, index) => (
                  <MatchRow
                    key={`${match.abn}-${match.entityName}`}
                    id={`${listId}-${index}`}
                    match={match}
                    acn={acns[match.abn]}
                    acnLoading={!(match.abn in acns) && !acnSettled.has(match.abn)}
                    active={index === activeIndex}
                    busy={pickingAbn === match.abn}
                    disabled={disabled || pickingAbn !== null}
                    onPick={() => void pick(match)}
                    onHover={() => setHighlight(index)}
                  />
                ))}
              </ul>
            )}

            <p className="border-t border-border px-3 py-1.5 text-[11px] text-foreground/30">
              Australian Business Register — suggestions only. Not listed, or listed wrong? Type
              it in and carry on.
            </p>
          </div>
        )}
      </div>

      {picked && <StatusNotice details={picked} onDismiss={() => setPicked(null)} />}
    </div>
  )
}

function MatchRow({
  id,
  match,
  acn,
  acnLoading,
  active,
  busy,
  disabled,
  onPick,
  onHover,
}: {
  id: string
  match: AbrNameMatch
  /** Undefined while unknown; '' when the register has none. */
  acn?: string
  /** The lookup is still out — show a placeholder, not a missing ACN. */
  acnLoading: boolean
  active: boolean
  busy: boolean
  disabled: boolean
  onPick: () => void
  onHover: () => void
}) {
  // Only a cancelled ABN earns a badge. An active one is the ordinary case and
  // needs no decoration, and a status the register expressed in a way we do not
  // recognise gets no claim made about it either way.
  const warn = match.status === 'cancelled'
  // The tidied form is what would go in the field; the register's own text sits
  // under it, because that is what somebody is checking before they pick.
  const tidied = tidyRegisterName(match.entityName)
  const differsFromSource = tidied !== match.entityName

  return (
    <li role="option" aria-selected={active} id={id}>
      <button
        type="button"
        tabIndex={-1}
        onClick={onPick}
        onMouseEnter={onHover}
        disabled={disabled}
        className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          active ? 'bg-surface' : ''
        }`}
      >
        <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/30" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-foreground">{tidied}</span>
          {differsFromSource && (
            <span className="block truncate text-[11px] uppercase tracking-wide text-foreground/30">
              {match.entityName}
            </span>
          )}
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-foreground/50">
            <span className="tabular-nums">ABN {match.abn}</span>
            {acn ? (
              <span className="tabular-nums">ACN {acn}</span>
            ) : (
              acnLoading && (
                <span className="inline-flex items-center gap-1" aria-label="Looking up ACN">
                  ACN
                  <span
                    aria-hidden="true"
                    className="inline-block h-3 w-16 animate-pulse rounded bg-border"
                  />
                </span>
              )
            )}
            {match.state && <span>{match.state}</span>}
            {match.postcode && <span className="tabular-nums">{match.postcode}</span>}
            {match.nameType && match.nameType !== 'Entity Name' && <span>{match.nameType}</span>}
          </span>
        </span>
        {busy ? (
          <Spinner size="sm" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        ) : (
          warn && (
            <Badge variant="destructive" className="mt-0.5 shrink-0">
              {abnStatusLabel(match.status)}
            </Badge>
          )
        )}
      </button>
    </li>
  )
}

/**
 * A cancelled ABN, said loudly.
 *
 * Material information for an insolvency matter, and the moment to see it is
 * before the client file is created rather than three weeks into the
 * engagement. It outlives the list that produced it, which is the point.
 */
function StatusNotice({ details, onDismiss }: { details: AbrEntityDetails; onDismiss: () => void }) {
  // Only warn about what the register actually said. An unreadable status is
  // not evidence of a problem, and inventing one on an insolvency file is worse
  // than staying quiet.
  if (details.status !== 'cancelled') return null

  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
      <p className="text-xs font-medium text-destructive">
        ABN cancelled on the register
        {details.abnStatusEffectiveFrom ? ` since ${details.abnStatusEffectiveFrom}` : ''}.
      </p>
      <p className="mt-0.5 text-xs leading-relaxed text-foreground/50">
        The details are filled in; check them before converting.{' '}
        <button
          type="button"
          onClick={onDismiss}
          className="text-foreground/40 underline underline-offset-2 transition-colors hover:text-foreground/70"
        >
          Dismiss
        </button>
      </p>
    </div>
  )
}
