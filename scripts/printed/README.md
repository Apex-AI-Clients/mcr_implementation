# As-printed regression

The test the financial statements reader (`src/lib/printed/`) is developed
against. Real client PDFs and their expected rows live in `/verified-figures/`,
which is gitignored: nothing here is ever committed.

```
verified-figures/
  pdfs/manifest.json                 alias -> clientId and its financial PDFs (aliases only, never names)
  pdfs/<alias>/<documentId>.pdf      the PDFs, downloaded from Storage
  printed/<alias>/<documentId>.txt   the text layer with cell positions (npm run printed:dump)
  printed/<alias>/<documentId>.expected.json
```

An expected file lists, per statement (profit and loss, balance sheet), the
title, pages, columns with their periods, and every printed row in order:
page, section path, label, style (`heading` / `line` / `subtotal` / `total` /
`ratio`) and the amount per column exactly as printed (cents kept, `null` for
nil). `pdfErrors` lists totals that do not add up in the PDF itself, as
`<title>|<row label>|<column header>`. `status` is `unverified` until staff
have checked the file against the PDF.

## Commands

- `npm run printed:check` reads every PDF with the current reader and
  compares it row by row with its expected file. Every printed total must
  verify (exact to the cent; whole-dollar statements to rounding) or be listed
  in `pdfErrors`. It prints the time per document. Run it on every reader
  change. `PRINTED_ALIAS=client-f` checks one client.
- `npm run printed:dump` writes each PDF's text layer with cell positions, to
  read alongside the page when writing or checking an expected file.

## A new layout

1. Add the PDF under `pdfs/<alias>/` and to `pdfs/manifest.json`.
2. Run `npm run printed:check`. With no expected file it writes
   `<documentId>.draft.json` and lists what the reader could not read, each
   with its page and printed line (`no_column_header`, `unknown_period`,
   `unplaced_cell`, `unparsed_amount`).
3. Make the one small reader change that line needs, with a synthetic unit
   test in `src/lib/printed/__tests__/`.
4. Check the draft against the PDF row by row (the page itself, and the dump),
   correct it, and save it as `<documentId>.expected.json`.
5. `npm run printed:check` must pass for every client, not only the new one.

The output shows aliases, document ids, printed lines and figures. It is for
local use only: never paste it anywhere outside the company.
