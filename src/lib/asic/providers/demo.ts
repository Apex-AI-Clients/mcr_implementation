import { AsicRejectedError } from '../errors'
import { mapAsicapiCompany, mapAsicapiExtract } from '../map'
import type { AsicCompany, AsicProvider, AsicPurchase, PurchaseOptions } from '../types'

/**
 * ASIC_PROVIDER=demo. Invented companies, invented people, never charged.
 *
 * For showing the flow — the priced button, the confirmation, the preview, the
 * two-director layout — without a provider account.
 *
 * It answers ONLY for its own invented ACNs and treats every other ACN as not
 * on the register. That is the point of it: a demo that answered for any ACN
 * would put Jane Sample and John Example on whatever real company somebody had
 * just picked from ABR, and that pairing would then be sitting in the form
 * looking like data. The ACNs pass the check digit so the rest of the flow
 * treats them like real ones; the names say plainly that they are not.
 *
 * The data is written in asicapi's own shape and goes through the same mapper,
 * so the demo also exercises the real mapping — including a director who is
 * also the secretary (shown once) and a ceased director (not shown).
 */

interface DemoCompany {
  lookup: Record<string, unknown>
  extract: Record<string, unknown>
}

const coded = (code: string, label: string) => ({ code, label })
const CURRENT = coded('C', 'Current')

function person(given: string[], family: string, birthDate: string | null) {
  return {
    type: 'person',
    person: { familyName: family, givenNames: given, formatted: [...given, family].join(' ') },
    birth: birthDate ? { date: birthDate, locality: 'SAMPLEVILLE', stateOrCountry: 'VIC' } : null,
    organisation: null,
  }
}

function officeholder(
  role: [string, string],
  party: ReturnType<typeof person>,
  ceasedAt: string | null = null,
) {
  return {
    object: 'officeholder',
    role: coded(...role),
    status: ceasedAt ? coded('E', 'Ceased/Former') : CURRENT,
    appointedAt: '2015-02-01',
    ceasedAt,
    party,
    address: null,
  }
}

function address(type: [string, string], parts: Record<string, string | null>) {
  return {
    object: 'address',
    type: coded(...type),
    status: CURRENT,
    from: '2018-01-15',
    to: null,
    address: { careOf: null, line1: null, country: 'AUSTRALIA', ...parts },
  }
}

const DIRECTOR: [string, string] = ['DR', 'Director']
const SECRETARY: [string, string] = ['SR', 'Secretary']
const REGISTERED: [string, string] = ['RG', 'Registered Office']
const PRINCIPAL: [string, string] = ['PA', 'Principal Place of Business']

function company(acn: string, abn: string, name: string) {
  return {
    object: 'company',
    acn,
    abn,
    name,
    type: coded('APTY', 'Australian Proprietary Company'),
    status: coded('REGD', 'Registered'),
  }
}

const SAMPLE_TRADING = company('000000019', '89000000019', 'SAMPLE TRADING PTY LTD')
const EXAMPLE_HOLDINGS = company('000000028', '91000000028', 'EXAMPLE HOLDINGS PTY LTD')

const DEMO_COMPANIES: Record<string, DemoCompany> = {
  // Two directors — the layout Gabby asked to see. Jane Sample is also the
  // secretary and appears once; the ceased director does not appear.
  '000000019': {
    lookup: SAMPLE_TRADING,
    extract: {
      company: SAMPLE_TRADING,
      addresses: [
        address(REGISTERED, {
          line1: 'LEVEL 2',
          street: '1 SAMPLE STREET',
          locality: 'NORTH MELBOURNE',
          state: 'VIC',
          postcode: '3051',
        }),
        address(PRINCIPAL, {
          line1: 'UNIT 4',
          street: '20 EXAMPLE ROAD',
          locality: 'RICHMOND',
          state: 'VIC',
          postcode: '3121',
        }),
      ],
      officeholders: [
        officeholder(DIRECTOR, person(['JANE'], 'SAMPLE', '1970-05-01')),
        officeholder(DIRECTOR, person(['JOHN'], 'EXAMPLE', '1982-11')),
        officeholder(SECRETARY, person(['JANE'], 'SAMPLE', '1970-05-01')),
        officeholder(DIRECTOR, person(['PAT'], 'FORMER', '1955-01-01'), '2021-06-30'),
      ],
    },
  },
  // One director with no date of birth, and a registered office that is also
  // the principal place of business — shown twice, as ASIC lists it.
  '000000028': {
    lookup: EXAMPLE_HOLDINGS,
    extract: {
      company: EXAMPLE_HOLDINGS,
      addresses: [
        address(REGISTERED, {
          street: '5 PLACEHOLDER LANE',
          locality: 'SAMPLEVILLE',
          state: 'NSW',
          postcode: '2000',
        }),
        address(PRINCIPAL, {
          street: '5 PLACEHOLDER LANE',
          locality: 'SAMPLEVILLE',
          state: 'NSW',
          postcode: '2000',
        }),
      ],
      officeholders: [officeholder(DIRECTOR, person(['ALEX'], 'PLACEHOLDER', null))],
    },
  },
}

/** For the "demo mode: try …" hint when an ACN is not one of these. */
export const DEMO_ACNS = Object.keys(DEMO_COMPANIES)

export function createDemoProvider(now: () => Date = () => new Date()): AsicProvider {
  return {
    name: 'demo',
    mode: 'demo',

    async lookupCompany(acn: string): Promise<AsicCompany | null> {
      const demo = DEMO_COMPANIES[acn]
      return demo ? mapAsicapiCompany(demo.lookup) : null
    },

    async purchaseCurrentExtract(acn: string, options: PurchaseOptions): Promise<AsicPurchase> {
      const demo = DEMO_COMPANIES[acn]
      if (!demo) {
        throw new AsicRejectedError(
          'Demo mode only has extracts for its own sample companies.',
          'company_not_found',
          404,
        )
      }

      const asOf = now().toISOString()
      return mapAsicapiExtract(
        {
          ...demo.extract,
          extract: {
            id: `demo_${acn}_${options.idempotencyKey.slice(0, 8)}`,
            type: 'current',
            purchasedAt: asOf,
            asOf,
          },
          meta: { billable: false, product: null, requestId: 'demo' },
        },
        acn,
      )
    },
  }
}
