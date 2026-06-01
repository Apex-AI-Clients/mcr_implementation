import { readFileSync } from 'node:fs'
import { parse } from 'csv-parse/sync'

const csv = readFileSync('supabase/seed/sbr_historical_cases.csv', 'utf8')
const rows = parse(csv, { columns: true, skip_empty_lines: true, trim: true })

console.log('-- 59 historical SBR cases.')
console.log('-- 41 accepted (from GABI_AI_DATA, excluding Future Bicycle + Life On Demand outliers)')
console.log('-- 18 rejected (from List_of_Rejected_SBR_s, submitted by Tom 28 May 2026)')
console.log('TRUNCATE TABLE public.sbr_historical_cases;')
console.log('INSERT INTO public.sbr_historical_cases (')
console.log('  client_name, dpn, payment_plan_type,')
console.log('  director_loan_at_appointment, director_loan_receivable_amount,')
console.log('  cumulative_days_late, number_of_late_lodgements, days_since_last_payment,')
console.log('  outcome_percent, accepted, creditor_amount, sbr_payment')
console.log(') VALUES')

const esc = (s) => `'${String(s).replace(/'/g, "''")}'`
const values = rows.map(
  (r) =>
    `(${esc(r.client_name)}, ${r.dpn}, ${esc(r.payment_plan_type)}, ${r.director_loan_at_appointment}, ${r.director_loan_receivable_amount}, ${r.cumulative_days_late}, ${r.number_of_late_lodgements}, ${r.days_since_last_payment}, ${r.outcome_percent}, ${r.accepted}, ${r.creditor_amount}, ${r.sbr_payment})`,
)
console.log(values.join(',\n') + ';')
