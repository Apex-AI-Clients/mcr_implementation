interface StageTabStripProps {
  /** The tabs. */
  children: React.ReactNode
  /** "Add stage" and "Edit stages": after the last tab, on the right. */
  trailing?: React.ReactNode
}

/**
 * The stage tabs, wrapping onto more rows as stages are added, so every tab
 * is in sight at once — no sideways scrolling to find one (requested
 * 14 Nov 2026; it used to be one scrolling row). With many stages the table
 * moves down by a row or two; that is the trade for seeing them all.
 */
export function StageTabStrip({ children, trailing }: StageTabStripProps) {
  return (
    <div className="-mt-2 mb-4 flex flex-wrap items-stretch gap-x-1 border-b border-border">
      {children}
      {trailing && <div className="ml-auto flex shrink-0 flex-wrap items-stretch">{trailing}</div>}
    </div>
  )
}
