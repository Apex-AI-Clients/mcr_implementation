/**
 * Every row of a query, read a page at a time.
 *
 * PostgREST caps one response (1,000 rows by default), and says nothing when it
 * does: a plain select of a table that has grown past the cap just comes back
 * short. `page` must order by a unique column so pages neither skip nor repeat.
 *
 *   const leads = await selectAll((from, to) =>
 *     supabase.from('leads').select('id, stage').order('id').range(from, to))
 */
export async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) return rows
  }
}
