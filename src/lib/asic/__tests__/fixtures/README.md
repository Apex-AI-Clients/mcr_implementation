# ASIC fixtures

Synthetic asicapi responses, in the shapes documented at
https://www.asicapi.com/docs (September 2026): coded values as
`{ "code", "label" }`, sections as plain arrays or `{ "object": "list", "data" }`,
dates as ISO strings.

**Every name, date of birth, address, ACN and ABN here is invented.** The ACNs
and ABNs pass their check digits so the code treats them like real numbers, but
they belong to nobody. No real extract, and no real person's details, may be
added to this folder — not even redacted. Build new cases by hand.

- `company_lookup.json` — `GET /v1/companies/{acn}`, the free lookup.
- `extract_two_directors.json` — `POST /v1/companies/{acn}/extracts`: two current
  directors (one full date of birth, one month/year), one of them also the
  secretary, a ceased director, a members section with residential addresses
  (must never survive redaction), a ceased registered office, and the ASIC
  contact address.
- `extract_edge_cases.json` — list-shaped sections, identity at the top level, a
  missing date of birth, a year-only date of birth, the registered office equal
  to the principal place of business, and unknown codes (label equal to code)
  on an address type, a role and a status.
