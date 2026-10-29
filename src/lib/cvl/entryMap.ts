import type { FormMap } from '@/lib/forms/types'

/**
 * A form's map as the entry screen needs it: questions in the form's own
 * order and numbering, each answer's type and label, the tables' columns.
 * No page coordinates. Pure.
 */

export type EntryFieldType = 'text' | 'lines' | 'money' | 'date' | 'yesno' | 'choice'

export interface EntryField {
  key: string
  label: string
  type: EntryFieldType
  /** Choice fields: value → label, in the form's order. */
  options?: [string, string][]
  /** Written by hand on the printout: shown, never typed or stored. */
  handwritten?: boolean
  /** Lines fields: how many printed lines there are. */
  lines?: number
}

export interface EntryTable {
  id: string
  title: string
  columns: { key: string; label: string; type: 'text' | 'money' | 'date' | 'check' }[]
  /** Rows on one printed page; more go onto copies of the page. */
  rowsPerPage: number
}

export interface EntrySection {
  q: string
  text: string
  fields: EntryField[]
  tables: EntryTable[]
}

export interface EntryMap {
  code: FormMap['code']
  title: string
  version: string
  sections: EntrySection[]
  /** The appendix tables carry "signed by …": the name asked for once. */
  hasTables: boolean
}

/** Human labels for the choice boxes the maps name by key. */
const CHOICE_LABELS: Record<string, string> = {
  receiver_manager: 'Receiver and Manager s421A(1) (507G)',
  managing_controller: 'Managing Controller s421A(1) (507H)',
  controller_director_report: 'Controller s429(2)(b) (507F)',
  court_liquidator: 'Court liquidator s475(1) (507C)',
  cvl_liquidator: 'Liquidator, creditors’ voluntary winding up s497(4) (507D)',
  voluntary_administrator: 'Voluntary Administrator s438B(2) (507K)',
}

export function entryMap(map: FormMap): EntryMap {
  const sections: EntrySection[] = []
  const byQ = new Map<string, EntrySection>()
  const section = (q: string) => {
    let s = byQ.get(q)
    if (!s) {
      const text = map.questions.find((x) => x.q === q)?.text ?? ''
      s = { q, text, fields: [], tables: [] }
      byQ.set(q, s)
      sections.push(s)
    }
    return s
  }
  // The questions in the form's order first, so a field never comes before its question.
  for (const q of map.questions) section(q.q)
  for (const f of map.fields) {
    const type: EntryFieldType =
      f.type === 'datecells' || f.type === 'date' || (f.type === 'text' && f.format === 'date') ? 'date' : f.type === 'text' ? 'text' : f.type
    section(f.q).fields.push({
      key: f.key,
      label: f.label,
      type,
      ...(f.type === 'choice' ? { options: Object.keys(f.options).map((k): [string, string] => [k, CHOICE_LABELS[k] ?? k.replace(/_/g, ' ')]) } : {}),
      ...(f.type === 'lines' ? { lines: f.lines.length } : {}),
      ...(f.handwritten ? { handwritten: true } : {}),
    })
  }
  for (const t of map.tables) {
    section(t.q).tables.push({
      id: t.id,
      title: t.title,
      columns: t.columns.map((c) => ({ key: c.key, label: c.label, type: c.type })),
      rowsPerPage: t.rows.length,
    })
  }
  return {
    code: map.code,
    title: map.title,
    version: map.version,
    sections: sections.filter((s) => s.fields.length || s.tables.length),
    hasTables: map.tables.length > 0,
  }
}
