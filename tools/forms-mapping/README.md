# Mapping an official ASIC form

The CVL forms are filled by writing answers on top of the official, unchanged
ASIC PDFs (`src/lib/forms/engine.ts`). A form's map says where every answer
goes. These tools produce the maps; none of them runs in the app.

| Form | Template (`src/lib/forms/templates/`) | Map (`src/lib/forms/maps/`) | Built by |
|---|---|---|---|
| Form 509 (17 Jan 2011) | `asic-form-509-2011.pdf` | `form509-2011.json` | `convert_reference_maps.ts` |
| Form 507 Part A (1 Aug 2022) | `asic-form-507-parta-20220801.pdf` | `form507-parta-20220801.json` | `build_parta_map.ts` |
| Form 507 Part B (1 Aug 2022) | `asic-form-507-partb-20220801.pdf` | `form507-partb-20220801.json` | `convert_reference_maps.ts` |

## Steps for a new form or version

1. Python with pdfplumber, in a virtualenv **outside the repo**:
   `python -m venv ~/venvs/forms && ~/venvs/forms/bin/pip install pdfplumber`.
2. Boxes, ruled lines and checkboxes: `python -I find_boxes.py form.pdf geo.json`
   (also writes `geo-words.json`: printed words with positions, for splitting
   Suburb/State/Postcode boxes at their labels).
3. Appendix tables: `python -I find_tables.py form.pdf tables.json 9 10 11 12`.
4. Numbered overlay to read box ids from:
   `npx tsx tools/forms-mapping/number_boxes.ts form.pdf geo.json ann.pdf`.
5. Write the map builder (see `build_parta_map.ts`), run it, then add the
   version to `src/lib/forms/registry.ts`.
6. Check: `npm run test -- src/lib/forms` (map integrity, overflow),
   `npm run forms:check` (blank fill pixel-identical to the PDF), then fill the
   synthetic sample, look at every page, and approve with `npm run forms:snapshot`.

Keep the intermediate JSON files out of the repo; they are regenerated from
the template in seconds.

## Notes on the 2022 Part A

- Page 7 is Form 507A (court liquidations, s475(1)). It is mapped but printed
  only when asked for (`include: ['507a']`); CVL printouts leave it out.
- Its two dates have their "/" printed outside the boxes, so those dates are
  written whole (DD/MM/YYYY).
- Table A7 is printed rotated by about a quarter of a degree; pdfplumber finds
  no grid, so its rows are measured from the ruled lines and drawn with a skew.
- Table A6 holds two grids (unrelated and related-party employees) on one page,
  each with a printed total row; totals are summed on the last page.
