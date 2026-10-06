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
