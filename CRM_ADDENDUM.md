# MCR CRM — Addendum: live form findings

Supersedes the debt-band section of `CRM_CHANGES.md` Stage 2.5, and replaces its
WordPress integration guidance entirely. Read this before running Stage 2.5.

Source: the live capture form at `https://www.mcrpartners.com.au/`, inspected
4 September.

---

## 1. The site is custom PHP, not WordPress

Evidence: `.php` routes (`complaints.php`), no plugin form markup, a self-posting
form with `name="submit_now"`, and an agency credit to webapex. Only `/blog/` is
likely WordPress, and it's not where leads come from.

Confirm in one step: view source, search for `wp-content`. Absent means custom.

**Consequence.** No WordPress hooks, no mu-plugin, no plugin webhook. The
integration is a direct edit to the PHP handler. See section 5.

**Access dependency — start now.** FTP or hosting credentials most likely sit with
webapex rather than Gabby. Agency turnaround is the schedule risk here, not the
code. Request access before Stage 5 is due.

The site already redirects to HTTPS, so submissions are encrypted in transit. No
action needed.

---

## 2. Debt: use a range, not an enum

### The problem

The live form offers six bands:

| Posted code | Label |
|---|---|
| `-1` | $30,000 – $49,999 |
| `1` | $50,000 – $74,999 |
| `2` | $75,000 – $99,999 |
| `3` | $100,000 – $124,999 |
| `4` | $125,000 – $149,999 |
| `5` | $150,000 or + |

The client described 100–250, 250–500, 500+. Those don't overlap with this set in
any recoverable way — `$150,000 or +` spans his entire stated range.

The likely explanation: this website sells consumer debt hardship (credit cards,
car and home loans), where figures are small. SBR is business insolvency, where
they aren't. The Facebook campaign probably targets the business side with larger
brackets. If so the two sources have genuinely different scales, and any single
enum loses information from one of them.

### The model

Replace `debtBand: DebtBand | null` with a range:

```ts
// src/types/leads.ts
/** Whole dollars. Null min means unknown; null max means open-ended. */
debtMin: number | null
debtMax: number | null
```

`$150,000 or +` → `{ min: 150000, max: null }`
`$100,000 – $124,999` → `{ min: 100000, max: 124999 }`
Nothing selected → `{ min: null, max: null }`

Any form's options map without negotiation, and a new Facebook bracket set needs no
migration.

### Presets

Editing is still a dropdown — the range is storage, not UI. Presets in
`constants.ts`, covering both scales:

```ts
export const DEBT_PRESETS: { label: string; min: number | null; max: number | null }[] = [
  { label: 'Not given',        min: null,   max: null },
  { label: 'Under $50k',       min: 0,      max: 49_999 },
  { label: '$50k – $75k',      min: 50_000, max: 74_999 },
  { label: '$75k – $100k',     min: 75_000, max: 99_999 },
  { label: '$100k – $125k',    min: 100_000, max: 124_999 },
  { label: '$125k – $150k',    min: 125_000, max: 149_999 },
  { label: '$150k+',           min: 150_000, max: null },
  { label: '$150k – $250k',    min: 150_000, max: 250_000 },
  { label: '$250k – $500k',    min: 250_000, max: 500_000 },
  { label: '$500k+',           min: 500_000, max: null },
]
```

`$150k+` and the narrower brackets above it deliberately coexist. A website lead
that only said "$150,000 or +" must not be presented as though it said $250k–$500k.

### Display

`formatDebtRange(min, max)` in `format.ts`:

- both null → `—`
- max null → `$150k+`
- otherwise → `$100k – $125k`

Abbreviate to `k` in the table, full figures on the record. Right-align the column.

### Sort and filter

Sort by `debtMin`, nulls last. Never sort by label — alphabetical puts $100k above
$500k.

The filter is an **overlap test**, not equality. "Over $250k" matches any lead whose
`debtMax` is null or `>= 250000`:

```ts
function overlapsFloor(lead: Lead, floor: number): boolean {
  if (lead.debtMax === null) return lead.debtMin === null ? false : lead.debtMin >= floor
  return lead.debtMax >= floor
}
```

Offer the filter as floors — Any, $50k+, $100k+, $150k+, $250k+, $500k+ — rather
than as bands. Gabby wants "show me the big ones", not "show me exactly this
bracket".

### CSV

Two columns, `Debt min` and `Debt max`, as bare numbers. A single label column
can't be filtered in a spreadsheet, which is the whole reason for the export.

---

## 3. Two fields the form already collects

### Business type

```ts
entityType: 'company' | 'trust' | null
```

Posted as `biz_type`, values `Company` and `Trust`.

This is a qualifying question, not metadata. SBR is available to incorporated
companies; a Trust is a different path. Put it in the table as a short badge so
nobody works a lead that can't convert, and show it on the record.

Editable on the record via the same select pattern as the debt preset.

### Preferred call time

```ts
preferredCallTime: string | null
```

Posted as `call_time`, free text and required on the form. Record only — it's too
variable to give a table column. Surface it on anything flagged for follow-up,
where "call after 6pm" is the difference between reaching someone and not.

---

## 4. Payload traps

**State sentinel.** The default option is `value="state"`, not empty. An unselected
state posts the literal string `state`. Treat it as null. Storing it would put
`state` in the State column.

**No NT.** The form offers VIC NSW QLD SA WA TAS ACT. `AuState` includes NT, which
is fine as a superset — Facebook or manual entry may supply it.

**Positional debt codes.** The select posts `-1`, `1`…`5`, not labels. Map on the
code, but the mapping is fragile: reordering the options silently changes what
every historical code meant. When editing the handler, change the values to
explicit slugs (`30k_50k`, `50k_75k`…) and map on those instead. Keep the old
numeric mapping for anything already captured.

**Message is required** on this form, so website leads will nearly always have one.
Facebook leads may not. Keep the field nullable.

**No spam protection.** No captcha, no honeypot. Whatever junk currently arrives by
email will start arriving in the CRM. The endpoint needs a honeypot field and
per-IP rate limiting from the first deploy.

---

## 5. PHP integration

Add to the existing handler, after the email send succeeds. Keep the email — it's
the parallel run, and it stays on until the feed is verified over a full week.

```php
function mcr_forward_lead(array $post): void {
    $endpoint = 'https://<app-host>/api/webhooks/leads/website';
    $secret   = getenv('MCR_LEAD_SECRET');   // server env, never inline

    if (!$secret) { error_log('[mcr_lead] secret not configured'); return; }

    $payload = json_encode([
        'external_id'  => bin2hex(random_bytes(16)),
        'name'         => $post['name']      ?? '',
        'email'        => $post['email']     ?? '',
        'phone'        => $post['phone']     ?? '',
        'biz_type'     => $post['biz_type']  ?? '',
        'debt_code'    => $post['debt']      ?? '',
        'state'        => $post['state']     ?? '',
        'call_time'    => $post['call_time'] ?? '',
        'message'      => $post['message']   ?? '',
        'submitted_at' => gmdate('c'),
    ]);

    $ch = curl_init($endpoint);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 5,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'X-MCR-Secret: ' . $secret,
        ],
    ]);
    $body = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($code !== 200) error_log("[mcr_lead] forward failed $code $body");
}
```

Rules for the edit:

- **Send the email first, forward second.** A CRM outage must never stop a lead
  reaching Gabby's inbox.
- **Never let this throw.** Wrap the call so a failure can't break the thank-you
  page. A submitting user should never see a PHP error because your endpoint was
  down.
- **5 second timeout.** It's blocking, so it costs the user latency. Long enough to
  succeed on a cold start, short enough not to be noticed.
- **Secret from server env**, not hardcoded. It will otherwise end up in a backup or
  a support ticket.
- **Take a copy of the handler before editing.** There is no version control on a
  hand-built PHP site.

### If site access is slow

A client-side POST from the browser is the only alternative, and it means an
unauthenticated public endpoint. Acceptable only with a honeypot, strict per-IP
rate limiting and a captcha, and only as a stopgap. Do not parse the notification
emails — that works until the template changes, then fails silently.

---

## 6. Revised Stage 2.5 prompt

If Stage 2.5 has already been run with the enum, this replaces it — revert and
rerun rather than layering a second change on top.

```
Read CRM_ADDENDUM.md, then CRM_CHANGES.md Stage 2.5 and CRM_BUILD.md.

The addendum supersedes the debt-band section: debt is stored as debtMin/debtMax
in whole dollars, not an enum. Section 2 has the model, presets, display, sort
and filter rules.

Implement in one change set:
  - message (nullable) — table column truncated, full text on the record,
    read-only, searchable, in the CSV
  - debtMin / debtMax replacing debtAmount — editable on the record via presets
  - entityType ('company' | 'trust' | null) — table badge, editable
  - preferredCallTime (nullable) — record only

Delete formatDebt and parseDebtInput and their tests. No money parsing survives.
Editing debt or entity type is a data correction: it must not reset lastActionAt
and must not write an activity.

Update mock.ts to cover all presets, including a couple with null debt and null
entity type. Work through the Stage 2.5 checklist plus:
  - [ ] Debt sorts by min with nulls last, never alphabetically
  - [ ] Floor filter matches open-ended ranges ($150k+ appears under $100k+)
  - [ ] formatDebtRange handles both-null, open-ended and closed cases

Stop there. Do not start Stage 4 or 5.
```

---

## 7. Confirm with the client

1. **Which bracket set is real.** He described 100–250 / 250–500 / 500+; his site
   offers $30k–$150k+. Is the Facebook campaign targeting business debt with larger
   brackets, or was he describing brackets he wants going forward? The range model
   tolerates either, but the Facebook form mapping can't be written until this is
   answered.
2. **Splitting `$150,000 or +`.** While the handler is being edited, adding
   $150–250k / $250–500k / $500k+ options costs nothing and ends the ambiguity for
   all future website leads. Worth asking whether the consumer-debt audience would
   ever select them.
3. **Business type in the pipeline.** Should a Trust lead be flagged, or routed
   differently? It can't take the SBR path.
4. **Site access** — does webapex hold it, and what's their turnaround?
5. **Spam volume today.** How much junk does the form currently generate by email?
   That sets how aggressive the honeypot and rate limiting need to be.
