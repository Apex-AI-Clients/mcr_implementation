'use client'

import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatDate } from '@/lib/utils'
import { uploadAsicExtract } from '@/lib/asic/browser'
import { ASIC_PDF_MIME } from '@/lib/asic/upload'
import {
  LIQUIDATOR_FIELDS,
  MCR_COMPANY_FIELDS,
  type CvlSettings,
  type SettingKey,
} from '@/lib/cvl/settings'

/**
 * The CVL settings: MCR's company details and the liquidator's, each saved on
 * its own. Blank items leave their boxes on the forms blank.
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
    </div>
  )
}

type Save = (key: SettingKey, value: unknown, confirmed: boolean) => Promise<string | null>

function Status({ settingKey, settings }: { settingKey: SettingKey; settings: CvlSettings }) {
  const updated = settings.updated[settingKey]
  return (
    <p className="flex flex-wrap items-center gap-2 text-xs">
      {updated && (
        <span className="text-foreground/40">
          Last changed {formatDate(updated.at)}
          {updated.by ? ` by ${updated.by}` : ''}
        </span>
      )}
    </p>
  )
}

/** One setting with one control and a save button. */
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
  const [state, setState] = useState<{ saving: boolean; error: string | null; done: boolean }>({ saving: false, error: null, done: false })
  const blank = value === '' || value === null

  const body = (
    <div className="space-y-2">
      <div>
        <h3 className={plain ? 'text-xs font-medium text-foreground/80' : 'text-sm font-semibold text-foreground'}>{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-foreground/50">{hint}</p>}
      </div>
      <Status settingKey={settingKey} settings={settings} />
      {render(value, (v) => {
        setValue(v)
        setState({ saving: false, error: null, done: false })
      })}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          loading={state.saving}
          onClick={async () => {
            setState({ saving: true, error: null, done: false })
            const error = await save(settingKey, blank ? null : value, settings.confirmed[settingKey] && !blank)
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
