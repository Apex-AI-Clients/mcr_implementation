'use client'

import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatDate } from '@/lib/utils'
import { uploadAsicExtract } from '@/lib/asic/browser'
import { ASIC_PDF_MIME } from '@/lib/asic/upload'
import {
  LIQUIDATOR_FIELDS,
  MCR_COMPANY_FIELDS,
  PLACEMENTS,
  PLACEMENT_KEYS,
  type CvlSettings,
  type SettingKey,
} from '@/lib/cvl/settings'

/**
 * The CVL settings: everything waiting for Gabby. Each item is saved on its
 * own, with a "Confirmed" tick; until it is ticked the item says
 * "To be confirmed". Blank items leave their boxes on the forms blank.
 */
export function CvlSettingsClient({ initial }: { initial: CvlSettings }) {
  const [settings, setSettings] = useState(initial)

  async function save(key: SettingKey, value: unknown, confirmed: boolean): Promise<string | null> {
    const res = await fetch('/api/admin/cvl/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value, confirmed }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return data.error || 'Failed to save'
    setSettings(data as CvlSettings)
    return null
  }

  return (
    <div className="space-y-6">
      <McrCompany settings={settings} save={save} />
      <TextGroup
        settingKey="liquidator"
        title="Liquidator details"
        hint="Form 509 lodgement details and the Part A External Administrator box. Blank until given."
        fields={LIQUIDATOR_FIELDS}
        values={settings.liquidator}
        settings={settings}
        save={save}
      />
      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Form 509: where each amount goes</h2>
        <p className="mt-1 text-xs text-foreground/50">
          No placement is made until one is chosen here. Until then each amount is listed beside the form, not on it.
        </p>
        <div className="mt-4 space-y-4">
          {PLACEMENT_KEYS.map((k) => (
            <Item
              key={k}
              settingKey={`f509_place.${k}`}
              title={PLACEMENTS[k].label}
              settings={settings}
              save={save}
              current={settings.placements[k] ?? ''}
              render={(value, set) => (
                <select value={String(value)} onChange={(e) => set(e.target.value)} className="h-10 w-full max-w-md rounded-lg border border-border bg-input-bg px-3 text-sm text-foreground">
                  <option value="">Not placed (to be confirmed)</option>
                  {Object.entries(PLACEMENTS[k].options).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
              plain
            />
          ))}
        </div>
      </section>
      <section className="rounded-xl border border-border bg-card p-4 text-xs text-foreground/60">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Also to be confirmed</h2>
        <ul className="list-disc space-y-1 pl-4">
          <li>Dates on the forms (appointment, summary, report, return-by): left blank, entered on each form with a date picker.</li>
          <li>Form 509 estimated realisable values: left blank; the book values go in the valuation column only.</li>
          <li>Anything the client file does not have: left blank, filled in on each form and checked in its preview.</li>
        </ul>
      </section>
    </div>
  )
}

type Save = (key: SettingKey, value: unknown, confirmed: boolean) => Promise<string | null>

function Status({ settingKey, settings, blank }: { settingKey: SettingKey; settings: CvlSettings; blank: boolean }) {
  const updated = settings.updated[settingKey]
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs">
      {settings.confirmed[settingKey] ? (
        <span className="inline-flex items-center gap-1 text-success">
          <CheckCircle2 className="h-3.5 w-3.5" /> Confirmed
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-warning">
          <AlertTriangle className="h-3 w-3" /> To be confirmed
        </span>
      )}
      {blank && <span className="text-destructive">Not set: the boxes it fills stay blank.</span>}
      {updated && (
        <span className="text-foreground/40">
          Last changed {formatDate(updated.at)}
          {updated.by ? ` by ${updated.by}` : ''}
        </span>
      )}
    </p>
  )
}

/** One setting with one control, its confirmed tick and a save button. */
function Item<V>({
  settingKey,
  title,
  hint,
  settings,
  save,
  current,
  render,
  plain = false,
}: {
  settingKey: SettingKey
  title: string
  hint?: string
  settings: CvlSettings
  save: Save
  current: V
  render: (value: V, set: (v: V) => void) => React.ReactNode
  plain?: boolean
}) {
  const [value, setValue] = useState(current)
  const [confirmed, setConfirmed] = useState(settings.confirmed[settingKey])
  const [state, setState] = useState<{ saving: boolean; error: string | null; done: boolean }>({ saving: false, error: null, done: false })
  const blank = value === '' || value === null

  const body = (
    <div className="space-y-2">
      <div>
        <h3 className={plain ? 'text-xs font-medium text-foreground/80' : 'text-sm font-semibold text-foreground'}>{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-foreground/50">{hint}</p>}
      </div>
      <Status settingKey={settingKey} settings={settings} blank={blank} />
      {render(value, (v) => {
        setValue(v)
        setState({ saving: false, error: null, done: false })
      })}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-foreground/70">
          <input type="checkbox" checked={confirmed} disabled={blank} onChange={(e) => setConfirmed(e.target.checked)} className="accent-accent" />
          Confirmed
        </label>
        <Button
          type="button"
          size="sm"
          loading={state.saving}
          onClick={async () => {
            setState({ saving: true, error: null, done: false })
            const error = await save(settingKey, blank ? null : value, confirmed && !blank)
            setState({ saving: false, error, done: !error })
          }}
        >
          Save
        </Button>
        {state.done && <span className="text-xs text-success">Saved</span>}
        {state.error && <span className="text-xs text-destructive">{state.error}</span>}
      </div>
    </div>
  )
  return plain ? body : <section className="rounded-xl border border-border bg-card p-4">{body}</section>
}

function TextGroup<K extends string>({
  settingKey,
  title,
  hint,
  fields,
  values,
  settings,
  save,
  extra,
}: {
  settingKey: SettingKey
  title: string
  hint: string
  fields: readonly (readonly [K, string])[]
  values: Partial<Record<K, string>>
  settings: CvlSettings
  save: Save
  extra?: (set: (v: Partial<Record<K, string>>) => void) => React.ReactNode
}) {
  return (
    <Item
      settingKey={settingKey}
      title={title}
      hint={hint}
      settings={settings}
      save={save}
      current={(Object.keys(values).length ? values : null) as Partial<Record<K, string>> | null}
      render={(value, set) => {
        const v = (value ?? {}) as Partial<Record<K, string>>
        return (
          <div className="space-y-3">
            {extra?.((next) => set({ ...v, ...next }))}
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map(([k, label]) => (
                <Input
                  key={k}
                  id={`${settingKey}-${k}`}
                  label={label}
                  value={v[k] ?? ''}
                  onChange={(e) => {
                    const next = { ...v, [k]: e.target.value }
                    set(Object.values(next).some((x) => typeof x === 'string' && x.trim()) ? next : null)
                  }}
                />
              ))}
            </div>
          </div>
        )
      }}
    />
  )
}

/** MCR's own company details, filled from MCR's ASIC extract (read here, never stored). */
function McrCompany({ settings, save }: { settings: CvlSettings; save: Save }) {
  const input = useRef<HTMLInputElement>(null)
  const [read, setRead] = useState<{ status: 'idle' | 'reading' | 'failed'; message?: string }>({ status: 'idle' })
  return (
    <TextGroup
      settingKey="mcr_company"
      title="MCR company details"
      hint="Form 509 lodgement details and the Part A External Administrator box. Filled from MCR's own ASIC extract, then checked."
      fields={MCR_COMPANY_FIELDS}
      values={settings.mcrCompany}
      settings={settings}
      save={save}
      extra={(set) => (
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={input}
            type="file"
            accept={ASIC_PDF_MIME}
            className="sr-only"
            aria-label="MCR's ASIC extract PDF"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              setRead({ status: 'reading' })
              const result = await uploadAsicExtract(file)
              if (!result.ok) {
                setRead({ status: 'failed', message: result.message })
                return
              }
              setRead({ status: 'idle' })
              const x = result.extract
              set({ companyName: x.companyName ?? '', acn: x.acn, address: x.registeredOffice ?? x.principalPlaceOfBusiness ?? '' })
            }}
          />
          <Button type="button" size="sm" variant="accent" loading={read.status === 'reading'} onClick={() => input.current?.click()}>
            <FileUp className="h-3.5 w-3.5" />
            Fill from MCR&rsquo;s ASIC extract
          </Button>
          <span className="text-xs text-foreground/40">Read here only; the PDF is not kept.</span>
          {read.status === 'failed' && <span className="text-xs text-destructive">{read.message}</span>}
        </div>
      )}
    />
  )
}
