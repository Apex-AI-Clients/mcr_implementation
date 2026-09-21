# MCR CRM — Change set: message, debt bands, ingestion

Follows `CRM_BUILD.md`. Save at the repo root alongside it and work through the
stages in order.

Client feedback, 4 September. Three field changes and the first real lead sources.

---

## Stage 2.5 — Message and debt bands

Paste:

```
Read CRM_CHANGES.md Stage 2.5, then CRM_BUILD.md for the design rules.

Two field changes to the existing CRM. Both touch types, mock data, table,
record, filters and CSV. Work through the checklist at the end and stop there.
Do not start Stage 4 or 5.
```

### Message

A free-text field the lead fills in on the capture form. Often empty.

```ts
// src/types/leads.ts — add to Lead
/** What the lead wrote on the capture form. Their words, not ours. */
message: string | null
```

**Table.** New column after State. Truncate to a single line with `truncate` and a
`title` attribute carrying the full text. Empty renders as a muted `—`, never a
blank cell — a blank cell reads as a rendering bug.

Give the column a `max-w-[16rem]` so a long message can't push Stage and Source off
screen. This is the one column allowed to lose information in the row; the record
has it in full.

**Record.** Full text in its own block above the activity timeline, headed
"Their message". Preserve line breaks with `whitespace-pre-wrap`. When null, omit
the block entirely rather than showing an empty heading.

**Read-only.** Do not add inline editing. This is the lead's own words and the only
verbatim record of what they asked for; staff commentary goes in notes. If the
client later insists on editing, add it then — but the default is immutable.

**Search.** Add message to `matchesSearch` in `filter.ts`. Searching what people
wrote is more useful than searching their phone number.

**CSV.** New column, after State, matching table order.

**Add lead dialog.** Optional textarea, three rows, placeholder "Anything they told
you". Saved to `message`, not as an activity — activities are things staff did.

### see CRM_ADDENDUM.md section 2.
### Debt bands

Replace the exact amount with a band. The client's capture forms offer ranges, and
an exact figure typed from a range is a fiction.

```ts
// src/types/leads.ts
export type DebtBand = 'under_100k' | '100k_250k' | '250k_500k' | '500k_plus'

// on Lead — replaces debtAmount entirely
/** Null when the source form didn't ask. Editable on the record. */
debtBand: DebtBand | null
```

```ts
// src/lib/leads/constants.ts
export const DEBT_BAND_META: Record<DebtBand, { label: string; short: string; order: number }> = {
  under_100k: { label: 'Under $100k',   short: '<100k',   order: 1 },
  '100k_250k': { label: '$100k – $250k', short: '100–250k', order: 2 },
  '250k_500k': { label: '$250k – $500k', short: '250–500k', order: 3 },
  '500k_plus': { label: '$500k+',        short: '500k+',   order: 4 },
}

/** Display and sort order. Never sort bands alphabetically — that puts
 *  $100k–$250k above $500k+. */
export const ALL_DEBT_BANDS: DebtBand[] = (Object.keys(DEBT_BAND_META) as DebtBand[])
  .sort((a, b) => DEBT_BAND_META[a].order - DEBT_BAND_META[b].order)
```

**Delete** `formatDebt` and `parseDebtInput` from `format.ts`, and their tests. No
money parsing survives this change. Replace with a `debtBandLabel(band)` helper that
returns `—` for null.

**Editable.** The client asked for this explicitly. A select on the record showing
the four bands plus "Not given". `InlineField` is text-only, so add a sibling
`InlineSelect` in `LeadRecordClient.tsx` following the same begin/save/cancel shape
and dispatching the existing `UPDATE_LEAD` action. Reuse the select primitive built
for `StageSelect`.

Changing the band is a data correction, not a follow-up action — it must **not**
reset `lastActionAt`, and must not write an activity. Only the four composer types
and stage changes touch the clock.

**Table.** The Debt column shows `short`. Right-align it — bands read as a scale and
should line up.

**Filter.** Add a debt band filter to `LeadFilterState`, `EMPTY_FILTERS`,
`hasActiveFilters` and `filterLeads`, following the existing stage/state/source
pattern exactly. Ordered by `order`, with "Any debt" first and a "Not given" option
that matches nulls. He will want to chase the big ones first.

**Add lead dialog.** Debt becomes a select, not a text input. Still required for
manual entry — if a human is typing the lead in, they know roughly what it is.

**Mock data.** `mock.ts` currently uses `dollars(s.debt)`. Map the existing figures
onto bands, and leave three or four leads with `debtBand: null` so the empty state
is visible on load. Keep the spread across all four bands.

**CSV.** Emit the full `label`, not the key. Someone opening this in Excel should
see `$100k – $250k`.

### Stage 2.5 checks

- [ ] `npm run type-check` and `npm run lint` clean
- [ ] `npm run test` passes; money-parsing tests deleted, band sort order tested
- [ ] No reference to `debtAmount`, `formatDebt` or `parseDebtInput` remains
- [ ] Long message doesn't break table layout at 1280px or below
- [ ] Null message and null band both render `—`, not blank
- [ ] Editing a band does not clear a follow-up flag
- [ ] Band filter combines correctly with the other filters
- [ ] Both themes checked

---

## Stage 4 — Persistence (unchanged, do this before Stage 5)

As specified in `CRM_BUILD.md`, with the schema updated for this change set:

```sql
message      text,                    -- nullable
debt_band    text check (debt_band in
               ('under_100k','100k_250k','250k_500k','500k_plus')),  -- nullable
```

Real leads cannot arrive before this stage exists. Anything ingested into the
in-memory store disappears on the next deploy.

---

## Stage 5 — Lead ingestion

Paste only after Stage 4 is merged:

```
Read CRM_CHANGES.md Stage 5.

Build the inbound lead endpoint. Split the work: mapping and validation are pure
and unit tested; persistence is a thin layer over the Stage 4 queries. Source is
stamped server-side from the route param and never read from the payload.
```

### The endpoint

`src/app/api/webhooks/leads/[source]/route.ts`

- `GET` handles Meta's verification handshake: compare `hub.verify_token` against
  the env secret and echo `hub.challenge` back as **plain text**. Return 403 on
  mismatch. If this handshake fails the subscription never activates, and Meta's
  error message won't tell you why.
- `POST` receives leads. Authenticate with a shared secret header for `website` and
  `google_form`; verify Meta's `X-Hub-Signature-256` HMAC for `facebook`.
- `source` comes from the route param, validated against `LeadSource`. Never from
  the body — otherwise anyone who finds the URL can post leads claiming to be
  Facebook ads.

### Mapping

`src/lib/leads/ingest.ts`, pure and unit tested against fixture payloads committed
under `src/lib/leads/__tests__/fixtures/`.

- Normalise phone with the existing `normalisePhone`
- Map free-text state to the `AuState` union; reject unrecognised values rather than
  storing junk
- Map the form's range answer to `DebtBand`; unmapped or absent → null, never a guess
- Trim message; empty string → null
- Facebook's standard fields are `full_name`, `email`, `phone_number`. Debt, state
  and message are custom questions whose keys depend on how the form was built — the
  mapping table must be config, not hardcoded, because it will differ between the
  test form and Gabby's real one.

### Facebook's two-step retrieval

The webhook payload contains a `leadgen_id` and `page_id`, not the lead. Fetch the
field values with `GET /{leadgen_id}?access_token={page_token}`. Store the
`leadgen_id` as the idempotency key.

### Rules that will save you

**Idempotency.** Meta retries on any non-200 and people double-submit forms. Unique
constraint on `(source, external_id)`. Second delivery is a no-op returning 200.

**Known email.** Not a new lead — a new touch. Append an activity to the existing
record and reset `lastActionAt` rather than creating a duplicate row for Gabby to
reconcile.

**Malformed payloads.** Never drop silently. Write the raw body and the parse error
to `lead_intake_log`, return 200 so Meta stops retrying, and surface the failure on
the lead sources settings screen. Otherwise a form change stops the lead flow and
nobody notices for a fortnight.

**Logging.** Log the source, external id and outcome. Do not log full payloads
outside `lead_intake_log` — they carry names, phone numbers and financial position.

### Stage 5 checks

- [ ] GET handshake returns the challenge as plain text; 403 on a bad token
- [ ] Bad or missing secret returns 401 and writes nothing
- [ ] Same `leadgen_id` twice creates one lead
- [ ] Known email appends an activity instead of duplicating
- [ ] Unmapped state rejected; unmapped debt range stored as null
- [ ] Malformed payload logged, 200 returned
- [ ] Source cannot be overridden from the body
- [ ] Fixture tests for both Facebook and WordPress payload shapes

---

## Account setup (no code — run in parallel)

### Facebook test environment

Free. Ad spend is the only thing Meta charges for, and none is needed.

1. Create a Facebook Page — "MCR CRM Test" or similar. The webhook subscribes to a
   Page, so one is required.
2. Create an app at developers.facebook.com, type Business. Leave it in
   **Development mode**.
3. Business Suite → Forms Library on that Page → create a lead form. Include the
   same questions as Gabby's real form: name, email, phone, debt range, state, and
   a free-text message. Publishing a form costs nothing.
4. Add the Webhooks product, subscribe to the `leadgen` field for that Page, point
   it at the endpoint, and complete the verification handshake.
5. Fire test submissions with the Lead Ads Testing Tool
   (developers.facebook.com/tools/lead-ads-testing).
6. Generate a long-lived Page access token and store it as an env var. Keep the
   page-id → credential mapping in config so switching to the real Page is a
   config change, not a code change.

While the app is in Development mode, `leads_retrieval` works for anyone holding an
app role, with no App Review. That's what makes the test setup immediate.

**Start now, even though the account can't be handed over:** moving to Gabby's real
Page needs App Review for `leads_retrieval` plus Business Verification on his
Business Manager. That's weeks on Meta's timeline. Verification attaches to the
business, not the login, so he can begin it before granting any access.

### WordPress site

The route depends on the form plugin. Identify it first — check the page source or
the plugin list.

| Plugin | Route |
|---|---|
| Elementor Pro Forms | Native Webhook action. No code. |
| Contact Form 7 | Snippet on the `wpcf7_mail_sent` hook |
| WPForms | Snippet on `wpforms_process_complete` (the webhook addon is paid) |
| Gravity Forms | Webhooks addon, Elite tier only — snippet is cheaper |

Whichever applies, install it as an **mu-plugin**, not an edit to the active theme's
`functions.php`. A theme update wipes `functions.php` and the lead feed dies quietly.

Put the shared secret in `wp-config.php` and read it from there. Never inline it in
the snippet, which may end up in a backup or a support ticket.

**Leave the existing email notification switched on** until the feed has been
verified over a full week. Two records beat a gap.

**Do not parse the notification emails.** It works until he edits the template, and
then it fails silently.

---

## Confirm with the client

1. **Band boundaries.** He said 100–250, 250–500, 500+. Is there an under-$100k
   option on his form, or is that a "not worth pursuing" case? The bands must match
   his forms exactly or the mapping drops leads to null.
2. **Editing the message.** He asked to edit the debt band; message is currently
   read-only, on the grounds that it's the lead's own words. Does he want to
   annotate — which is what notes are for — or actually overwrite?
3. **Which WordPress form plugin**, and who has admin on the site.
4. **His live Facebook form's exact question labels**, once he can share them. Needed
   for the mapping config regardless of when access lands.
