import type { Lead, LeadActivity } from '@/types/leads'

/**
 * Mock CRM data — DELETE IN STAGE 4.
 *
 * Every name, email, phone number and company here is invented. No real MCR
 * contact goes in this repo; real lead data waits for Stage 4 and the company
 * Supabase project.
 *
 * Dates are computed relative to module load, never hardcoded — otherwise the
 * demo rots and every follow-up flag fires at once next month.
 */

const DAY_MS = 86_400_000
const LOADED_AT = new Date()

/** ISO timestamp `n` days before module load. */
function daysAgo(n: number): string {
  return new Date(LOADED_AT.getTime() - n * DAY_MS).toISOString()
}

/** Dollars → integer cents. Money never touches a float. */
function dollars(amount: number): number {
  return Math.round(amount * 100)
}

interface LeadSeed {
  id: string
  name: string
  email: string
  phone: string
  debt: number
  state: Lead['state']
  stage: Lead['stage']
  source: Lead['source']
  company: string | null
  nextStep: string | null
  created: number
  stageSince: number
  lastAction: number
}

// Coverage is deliberate: all six stages, all four sources, all eight states,
// debts from ~$30k to ~$400k, and four open leads left deliberately stale so
// the follow-up flag is visible on first load.
const SEEDS: LeadSeed[] = [
  {
    id: 'ld_01',
    name: 'Marcus Oyelaran',
    email: 'marcus.oyelaran@brightpathjoinery.com.au',
    phone: '0402 915 338',
    debt: 41_500,
    state: 'VIC',
    stage: 'lead',
    source: 'facebook',
    company: 'Brightpath Joinery Pty Ltd',
    nextStep: 'Call back Thursday morning',
    created: 6,
    stageSince: 6,
    lastAction: 6,
  },
  {
    id: 'ld_02',
    name: 'Priya Raman',
    email: 'priya@ramanfreighthire.com.au',
    phone: '0433 217 604',
    debt: 92_500,
    state: 'VIC',
    stage: 'lead',
    source: 'website',
    company: null,
    nextStep: 'Send SBR explainer pack',
    created: 7,
    stageSince: 7,
    lastAction: 5,
  },
  {
    id: 'ld_03',
    name: 'Ellery Mason',
    email: 'ellery.mason@masonfitout.com.au',
    phone: '0412 883 190',
    debt: 148_000,
    state: 'NSW',
    stage: 'prospect',
    source: 'facebook',
    company: 'Mason Fitout Group',
    nextStep: 'Waiting on BAS statements',
    created: 18,
    stageSince: 11,
    lastAction: 3,
  },
  {
    id: 'ld_04',
    name: 'Sasha Lorenz',
    email: 'sasha.lorenz@lorenzautoworks.com.au',
    phone: '0421 004 772',
    debt: 64_000,
    state: 'NSW',
    stage: 'lead',
    source: 'facebook',
    company: null,
    nextStep: 'Second attempt at contact',
    created: 40,
    stageSince: 40,
    lastAction: 34,
  },
  {
    id: 'ld_05',
    name: 'Dean Whitlock',
    email: 'dean@whitlockcivil.com.au',
    phone: '0407 552 118',
    debt: 210_000,
    state: 'QLD',
    stage: 'prospect',
    source: 'google_form',
    company: 'Whitlock Civil Contracting',
    nextStep: 'Book director meeting for next week',
    created: 25,
    stageSince: 16,
    lastAction: 2,
  },
  {
    id: 'ld_06',
    name: 'Nadia Kovac',
    email: 'nadia.kovac@harbourlinecafe.com.au',
    phone: '0438 671 205',
    debt: 37_200,
    state: 'WA',
    stage: 'lead',
    source: 'website',
    company: 'Harbourline Cafe',
    nextStep: null,
    created: 12,
    stageSince: 12,
    lastAction: 9,
  },
  {
    id: 'ld_07',
    name: 'Tobias Renn',
    email: 'tobias@rennmetalfab.com.au',
    phone: '0415 380 926',
    debt: 305_000,
    state: 'SA',
    stage: 'client',
    source: 'manual',
    company: 'Renn Metal Fabrication',
    nextStep: 'Chase trust deed and FY24 financials',
    created: 60,
    stageSince: 22,
    lastAction: 4,
  },
  {
    id: 'ld_08',
    name: 'Imogen Castellan',
    email: 'imogen@castellanflorists.com.au',
    phone: '0429 118 447',
    debt: 52_750,
    state: 'TAS',
    stage: 'lead',
    source: 'facebook',
    company: null,
    nextStep: 'Left voicemail, no response yet',
    created: 50,
    stageSince: 50,
    lastAction: 41,
  },
  {
    id: 'ld_09',
    name: 'Rafael Ubaldo',
    email: 'rafael.ubaldo@ubaldoprinting.com.au',
    phone: '0466 930 512',
    debt: 121_000,
    state: 'ACT',
    stage: 'prospect',
    source: 'website',
    company: 'Ubaldo Printing Services',
    nextStep: 'Confirm director penalty notice dates',
    created: 33,
    stageSince: 20,
    lastAction: 11,
  },
  {
    id: 'ld_10',
    name: 'Wren Halliday',
    email: 'wren@hallidaylogistics.com.au',
    phone: '0490 226 851',
    debt: 88_400,
    state: 'NT',
    stage: 'lead',
    source: 'google_form',
    company: 'Halliday Logistics NT',
    nextStep: null,
    created: 21,
    stageSince: 21,
    lastAction: 21,
  },
  {
    id: 'ld_11',
    name: 'Camille Ashgrove',
    email: 'camille@ashgroveinteriors.com.au',
    phone: '0404 717 283',
    debt: 175_000,
    state: 'NSW',
    stage: 'converted',
    source: 'facebook',
    company: 'Ashgrove Interiors',
    nextStep: null,
    created: 90,
    stageSince: 12,
    lastAction: 12,
  },
  {
    id: 'ld_12',
    name: 'Hugo Pemberton',
    email: 'hugo.pemberton@pembertontiling.com.au',
    phone: '0417 645 099',
    debt: 46_900,
    state: 'VIC',
    stage: 'non_proceeding',
    source: 'website',
    company: null,
    nextStep: null,
    created: 75,
    stageSince: 55,
    lastAction: 55,
  },
  {
    id: 'ld_13',
    name: 'Delphine Marek',
    email: 'delphine@marekbakehouse.com.au',
    phone: '0426 508 314',
    debt: 33_000,
    state: 'QLD',
    stage: 'do_not_contact',
    source: 'facebook',
    company: 'Marek Bakehouse',
    nextStep: null,
    created: 68,
    stageSince: 62,
    lastAction: 62,
  },
  {
    id: 'ld_14',
    name: 'Oscar Vandeleur',
    email: 'oscar@vandeleurearthmoving.com.au',
    phone: '0435 872 640',
    debt: 268_500,
    state: 'WA',
    stage: 'prospect',
    source: 'manual',
    company: 'Vandeleur Earthmoving',
    nextStep: 'Review ATO integrated client account',
    created: 45,
    stageSince: 30,
    lastAction: 6,
  },
  {
    id: 'ld_15',
    name: 'Bettina Sarkis',
    email: 'bettina.sarkis@sarkistextiles.com.au',
    phone: '0448 193 726',
    debt: 59_300,
    state: 'NSW',
    stage: 'lead',
    source: 'google_form',
    company: null,
    nextStep: 'Follow up after school holidays',
    created: 80,
    stageSince: 80,
    lastAction: 58,
  },
  {
    id: 'ld_16',
    name: 'Lachlan Fitzroy',
    email: 'lachlan@fitzroyscaffolding.com.au',
    phone: '0409 334 205',
    debt: 396_000,
    state: 'VIC',
    stage: 'client',
    source: 'facebook',
    company: 'Fitzroy Scaffolding Group',
    nextStep: 'Restructuring plan draft due Friday',
    created: 110,
    stageSince: 38,
    lastAction: 8,
  },
  {
    id: 'ld_17',
    name: 'Yusra Almeida',
    email: 'yusra@almeidadental.com.au',
    phone: '0423 660 178',
    debt: 71_800,
    state: 'SA',
    stage: 'lead',
    source: 'website',
    company: 'Almeida Dental Studio',
    nextStep: null,
    created: 95,
    stageSince: 95,
    lastAction: 76,
  },
  {
    id: 'ld_18',
    name: 'Corben Thistlewood',
    email: 'corben@thistlewoodplumbing.com.au',
    phone: '0411 927 583',
    debt: 134_250,
    state: 'QLD',
    stage: 'prospect',
    source: 'facebook',
    company: 'Thistlewood Plumbing',
    nextStep: 'Send engagement letter',
    created: 29,
    stageSince: 15,
    lastAction: 14,
  },
  {
    id: 'ld_19',
    name: 'Anouk Riviere',
    email: 'anouk@riviereeventhire.com.au',
    phone: '0432 145 890',
    debt: 189_000,
    state: 'ACT',
    stage: 'converted',
    source: 'google_form',
    company: 'Riviere Event Hire',
    nextStep: null,
    created: 130,
    stageSince: 20,
    lastAction: 20,
  },
  {
    id: 'ld_20',
    name: 'Sunniva Bellweather',
    email: 'sunniva@bellweatherbooks.com.au',
    phone: '0407 218 336',
    debt: 30_500,
    state: 'TAS',
    stage: 'lead',
    source: 'manual',
    company: null,
    nextStep: 'Initial call booked',
    created: 3,
    stageSince: 3,
    lastAction: 3,
  },
]

const LEADS: Lead[] = SEEDS.map((s) => ({
  id: s.id,
  name: s.name,
  email: s.email,
  phone: s.phone,
  debtAmount: dollars(s.debt),
  state: s.state,
  stage: s.stage,
  source: s.source,
  company: s.company,
  nextStep: s.nextStep,
  stageSince: daysAgo(s.stageSince),
  lastActionAt: daysAgo(s.lastAction),
  // No seeded links: a client file id only exists once a real conversion has
  // run. Leads seeded at stage "converted" have no file behind them, which is
  // also what an imported sheet row looks like.
  convertedClientId: null,
  createdAt: daysAgo(s.created),
  updatedAt: daysAgo(s.lastAction),
}))

interface ActivitySeed {
  leadId: string
  type: LeadActivity['type']
  body: string
  author: string
  daysAgo: number
}

// A few leads carry rich history; most have a single entry. The stale ones keep
// their only activity well behind the threshold.
const ACTIVITY_SEEDS: ActivitySeed[] = [
  { leadId: 'ld_01', type: 'note', body: 'Enquiry via Facebook ad. Joinery business, ATO debt around $41k, two employees.', author: 'Gabby', daysAgo: 6 },
  { leadId: 'ld_02', type: 'call', body: 'Spoke briefly. Freight hire, single director. Asked for written material before committing to a meeting.', author: 'Gabby', daysAgo: 5 },
  { leadId: 'ld_02', type: 'note', body: 'Website enquiry form submitted overnight.', author: 'System', daysAgo: 7 },

  { leadId: 'ld_03', type: 'next_step', body: 'Waiting on BAS statements for FY24 and FY25.', author: 'Gabby', daysAgo: 3 },
  { leadId: 'ld_03', type: 'email', body: 'Sent document checklist and portal invitation details.', author: 'Gabby', daysAgo: 7 },
  { leadId: 'ld_03', type: 'stage_change', body: 'Stage changed from Lead to Prospect.', author: 'Gabby', daysAgo: 11 },
  { leadId: 'ld_03', type: 'call', body: 'Good first conversation. Fitout business, three sites, debt mostly PAYG withholding.', author: 'Gabby', daysAgo: 14 },
  { leadId: 'ld_03', type: 'note', body: 'Facebook ad enquiry.', author: 'System', daysAgo: 18 },

  { leadId: 'ld_04', type: 'call', body: 'No answer, left a message.', author: 'Gabby', daysAgo: 34 },

  { leadId: 'ld_05', type: 'call', body: 'Director keen to move. Civil contracting, $210k across PAYG and GST.', author: 'Gabby', daysAgo: 2 },
  { leadId: 'ld_05', type: 'stage_change', body: 'Stage changed from Lead to Prospect.', author: 'Gabby', daysAgo: 16 },
  { leadId: 'ld_05', type: 'note', body: 'Google Form submission from the SBR landing page.', author: 'System', daysAgo: 25 },

  { leadId: 'ld_06', type: 'email', body: 'Replied to website enquiry with an outline of the SBR process.', author: 'Gabby', daysAgo: 9 },

  { leadId: 'ld_07', type: 'next_step', body: 'Chase trust deed and FY24 financials.', author: 'Gabby', daysAgo: 4 },
  { leadId: 'ld_07', type: 'email', body: 'Portal invite sent. Client has uploaded the ICA and current financials so far.', author: 'Gabby', daysAgo: 9 },
  { leadId: 'ld_07', type: 'stage_change', body: 'Stage changed from Prospect to Client.', author: 'Gabby', daysAgo: 22 },
  { leadId: 'ld_07', type: 'note', body: 'Referred by an existing contact. Metal fabrication, 11 staff.', author: 'Gabby', daysAgo: 60 },

  { leadId: 'ld_08', type: 'call', body: 'Left voicemail. No response to the earlier email either.', author: 'Gabby', daysAgo: 41 },

  { leadId: 'ld_09', type: 'next_step', body: 'Confirm the director penalty notice dates before advising.', author: 'Gabby', daysAgo: 11 },
  { leadId: 'ld_09', type: 'stage_change', body: 'Stage changed from Lead to Prospect.', author: 'Gabby', daysAgo: 20 },

  { leadId: 'ld_10', type: 'note', body: 'Google Form submission. Logistics operator in Darwin, debt around $88k.', author: 'System', daysAgo: 21 },

  { leadId: 'ld_11', type: 'stage_change', body: 'Stage changed from Client to Converted.', author: 'Gabby', daysAgo: 12 },
  { leadId: 'ld_11', type: 'note', body: 'Client file created in the restructuring workspace.', author: 'Gabby', daysAgo: 12 },

  { leadId: 'ld_12', type: 'stage_change', body: 'Stage changed from Prospect to Non-proceeding.', author: 'Gabby', daysAgo: 55 },
  { leadId: 'ld_12', type: 'call', body: 'Director decided to wind the company down instead. Not proceeding with an SBR.', author: 'Gabby', daysAgo: 55 },

  { leadId: 'ld_13', type: 'stage_change', body: 'Stage changed from Lead to Do not contact.', author: 'Gabby', daysAgo: 62 },
  { leadId: 'ld_13', type: 'note', body: 'Asked not to be contacted again.', author: 'Gabby', daysAgo: 62 },

  { leadId: 'ld_14', type: 'next_step', body: 'Review the ATO integrated client account once it arrives.', author: 'Gabby', daysAgo: 6 },
  { leadId: 'ld_14', type: 'stage_change', body: 'Stage changed from Lead to Prospect.', author: 'Gabby', daysAgo: 30 },
  { leadId: 'ld_14', type: 'note', body: 'Added manually after a phone enquiry. Earthmoving, large plant finance exposure.', author: 'Gabby', daysAgo: 45 },

  { leadId: 'ld_15', type: 'email', body: 'Sent follow-up. No reply.', author: 'Gabby', daysAgo: 58 },

  { leadId: 'ld_16', type: 'next_step', body: 'Restructuring plan draft due Friday.', author: 'Gabby', daysAgo: 8 },
  { leadId: 'ld_16', type: 'call', body: 'Went through the proposal with both directors. Largest file on the books.', author: 'Gabby', daysAgo: 15 },
  { leadId: 'ld_16', type: 'stage_change', body: 'Stage changed from Prospect to Client.', author: 'Gabby', daysAgo: 38 },

  { leadId: 'ld_17', type: 'note', body: 'Website enquiry. Dental practice, debt around $72k. No contact since.', author: 'System', daysAgo: 76 },

  { leadId: 'ld_18', type: 'next_step', body: 'Send engagement letter.', author: 'Gabby', daysAgo: 14 },
  { leadId: 'ld_18', type: 'stage_change', body: 'Stage changed from Lead to Prospect.', author: 'Gabby', daysAgo: 15 },

  { leadId: 'ld_19', type: 'stage_change', body: 'Stage changed from Client to Converted.', author: 'Gabby', daysAgo: 20 },

  { leadId: 'ld_20', type: 'note', body: 'Added manually. Bookshop, small ATO debt, wants advice early.', author: 'Gabby', daysAgo: 3 },
]

const ACTIVITIES: LeadActivity[] = ACTIVITY_SEEDS.map((a, i) => ({
  id: `act_${String(i + 1).padStart(3, '0')}`,
  leadId: a.leadId,
  type: a.type,
  body: a.body,
  author: a.author,
  createdAt: daysAgo(a.daysAgo),
}))

/** The single seam Stage 4 replaces with a Supabase query. */
export function getLeads(): Lead[] {
  return LEADS
}

/** Every seeded activity — the store slices these per lead. */
export function getAllLeadActivities(): LeadActivity[] {
  return ACTIVITIES
}

/** Activities for one lead, newest first. */
export function getLeadActivities(leadId: string): LeadActivity[] {
  return ACTIVITIES.filter((a) => a.leadId === leadId).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )
}
