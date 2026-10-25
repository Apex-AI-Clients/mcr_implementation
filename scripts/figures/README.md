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

2. Run `npm run figures:snapshot`. This only reads the database (SELECT
   queries) and writes `verified-figures/<alias>.snapshot.json`: the ATO
   account rows and the stored director penalty notices.

3. Run `npm run figures:check`. It needs no database. It reruns the lodgement
   analysis with the current code (from `<alias>.ica.csv` or the snapshot's
   rows), the ATO debt the prediction takes from the ATO account, and the DPN
   totals, and prints every figure that differs from the `lodgement`,
   `prediction` and `dpnNotices` keys of `verified-figures/<alias>.expected.json`.

The output shows aliases, keys and figures only. It never shows client names,
filenames or free-text line labels.

The financial statements are checked by `npm run printed:check`
(`scripts/printed`), from the PDFs as printed.

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
