'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { formatDate } from '@/lib/utils'
import {
  EA_FIELDS,
  LODGEMENT_FIELDS,
  type CvlSettings,
  type SettingKey,
} from '@/lib/cvl/settings'

/**
 * The CVL settings: Form 509's lodgement details and Part A's External
 * Administrator, each saved on its own. Blank items leave their boxes on
 * the forms blank (the lodgement details go back to their starting values).
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
      <TextGroup
        settingKey="lodgement"
        title="Form 509 lodgement details"
        hint="Pre-filled on every Form 509 (who lodges it, and who ASIC should contact). Starts as on the Form 509 MCR lodges with; change and save to use other details. Clearing every box brings those back."
        fields={LODGEMENT_FIELDS}
        values={settings.lodgement}
        settings={settings}
        save={save}
      />
      <ExternalAdministrator settings={settings} save={save} />
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
}: {
  settingKey: SettingKey
  title: string
  hint: string
  fields: readonly (readonly [K, string])[]
  values: Partial<Record<K, string>>
  settings: CvlSettings
  save: Save
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

/** Part A's External Administrator box, one field per box on the form, typed in. */
function ExternalAdministrator({ settings, save }: { settings: CvlSettings; save: Save }) {
  return (
    <TextGroup
      settingKey="external_administrator"
      title="External Administrator (Form 507 Part A)"
      hint="Pre-filled in the External Administrator box of every Part A, box for box. Blank until given."
      fields={EA_FIELDS}
      values={settings.externalAdministrator}
      settings={settings}
      save={save}
    />
  )
}
