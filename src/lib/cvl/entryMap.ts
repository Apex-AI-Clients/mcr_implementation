import { cellRoomOf, roomOf, type Room } from '@/lib/forms/fit'
import type { FormMap } from '@/lib/forms/types'

/**
 * A form's map as the entry screen needs it: questions in the form's own
 * order and numbering, each answer's type and label, the tables' columns,
 * where each is printed and how much room its box gives. Pure.
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
  /** The template page it is printed on: the preview shows it while it is edited. */
  page: number
  /** How far down that page it is printed (points from the top): the preview scrolls there. */
  top: number
  /**
   * Form 509's summary: the printed column the amount goes in, and the row it
   * belongs to. Each row shows its boxes under the form's own two headings.
   */
  column?: 'valuation' | 'erv'
  row?: string
  /** Left blank, the form adds it up from the boxes above (Form 509 totals). */
  computed?: boolean
  /** For a computed field: the boxes it adds up (the screen shows the total as it will print). */
  sum?: string[]
  /** Typed inside its row of the summary table (line 4's "…assets to:"), not on its own. */
  inline?: boolean
  /** The room its box gives on the form, to warn when an answer would be cut off. */
  room?: Room
}

export interface EntryTable {
  id: string
  title: string
  /** Text columns carry the room a cell gives, to warn when an entry would be cut off. */
  columns: { key: string; label: string; type: 'text' | 'money' | 'date' | 'check'; room?: Room }[]
  /** Rows on one printed page; more go onto copies of the page. */
  rowsPerPage: number
  /** The template page the table is printed on. */
  page: number
  /** Its first row, in points from the top of the page. */
  top: number
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

/** The choice boxes the maps name by key, in the form's own words (Part A, page 2). */
const CHOICE_LABELS: Record<string, string> = {
  receiver_manager: 'Receiver and Manager - s421A(1) 507G',
  managing_controller: 'Managing Controller of property - s421A(1) 507H',
  controller_director_report: 'Receiver, Receiver and Manager or Controller (Director Report) - s429(2)(b) 507F',
  court_liquidator: 'Liquidator/Provisional Liquidator appointed by the court - s475(1) 507C',
  cvl_liquidator: 'Liquidator – creditors’ voluntary winding up – s497(4) 507D',
  voluntary_administrator: 'Voluntary Administrator - s438B(2) 507K',
}

/** Form 509's two money columns: Valuation from x 400, Estimated realisable value from x 483. */
const ERV_COLUMN_X0 = 480

/** "1(b) Sundry debtors: Valuation" → "1(b) Sundry debtors". */
const rowLabel = (label: string) =>
  label.replace(/: (Valuation|Estimated realisable value)$/, '').replace(/ \(valuation\)$/, '')

const withRoom = (room: Room | null): { room?: Room } => (room ? { room } : {})

/** The top of an answer's first box on its page. */
function topOf(f: FormMap['fields'][number]): number {
  switch (f.type) {
    case 'lines':
      return f.lines[0]?.top ?? 0
    case 'datecells':
      return f.cells[0]?.top ?? 0
    case 'yesno':
      return Math.min(f.yes.top, f.no.top)
    case 'choice':
      return Math.min(...Object.values(f.options).map((b) => b.top))
    default:
      return f.top
  }
}

export function entryMap(map: FormMap): EntryMap {
  const computed = new Map((map.computed ?? []).map((c) => [c.key, c.sum]))
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
      page: f.page,
      top: Math.round(topOf(f)),
      ...(map.code === '509' && f.type === 'money'
        ? { column: f.x0 >= ERV_COLUMN_X0 ? ('erv' as const) : ('valuation' as const), row: rowLabel(f.label) }
        : {}),
      ...(computed.has(f.key) ? { computed: true, sum: computed.get(f.key)! } : {}),
      // Line 4's "to:" blank sits in line 4's row.
      ...(map.code === '509' && f.key === 'r4_to'
        ? { inline: true, row: rowLabel(map.fields.find((x) => x.key === 'r4')?.label ?? f.label) }
        : {}),
      ...(f.type === 'choice' ? { options: Object.keys(f.options).map((k): [string, string] => [k, CHOICE_LABELS[k] ?? k.replace(/_/g, ' ')]) } : {}),
      ...(f.type === 'lines' ? { lines: f.lines.length } : {}),
      ...(f.handwritten ? { handwritten: true } : {}),
      ...(f.handwritten ? {} : withRoom(roomOf(f))),
    })
  }
  for (const t of map.tables) {
    section(t.q).tables.push({
      id: t.id,
      title: t.title,
      columns: t.columns.map((c) => ({ key: c.key, label: c.label, type: c.type, ...withRoom(cellRoomOf(c)) })),
      rowsPerPage: t.rows.length,
      page: t.page,
      top: Math.round(t.rows[0]?.top ?? 0),
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
