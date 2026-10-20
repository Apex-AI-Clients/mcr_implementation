# Verified figures

A regression check against the real test clients, kept entirely outside git.
`/verified-figures/` is gitignored; nothing in it is ever committed.

1. Create `verified-figures/clients.json`, with aliases rather than client names:

   ```json
   [
     { "alias": "client-a", "clientId": "<uuid>" },
     { "alias": "client-b", "clientId": "<uuid>" }
   ]
   ```

2. After re-extracting a test client, run `npm run figures:snapshot`. This only
   reads the database (SELECT queries) and writes
   `verified-figures/<alias>.snapshot.json`.

3. Run `npm run figures:check`. It needs no database. It rebuilds each
   comparison with the current code: the extraction-time line corrections are
   replayed over the stored lines, then the comparison is assembled. It then
   prints every figure that differs from `verified-figures/<alias>.expected.json`.
   The first run writes `<alias>.draft.json` instead. Check the draft against
   the statements, keep the keys you have verified, and save it as
   `<alias>.expected.json`.

The output shows aliases, schema keys and figures only. It never shows client
names, filenames or free-text line labels.

The replay doesn't include the AI read or the text-layer check, so differences
that come from those only show after a re-extraction and a new snapshot.

## Director penalty notices

`npm run figures:dpn` reads every PDF in `/dpn-samples/` (gitignored) with the
current DPN parser and compares each notice with
`verified-figures/dpn.expected.json`. That file is keyed by notice type
(`paygw`, `gst`), so it holds no filename, reference or name:

```json
{
  "notices": {
    "paygw": { "issuedOn": "2026-09-30", "rows": 18, "totals": { "column2": 0, "column3": 0, "column4": 0, "column5": 0 } }
  }
}
```

Totals are in cents. The output shows the notice type, dates, the row count,
which checks failed and the totals. Fields such as the reference, ACN and
director are reported only as found or MISSING, never by value, and the
director's address is never read into the result at all.
