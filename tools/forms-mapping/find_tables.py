"""Appendix table geometry for a form PDF.

usage: python -I find_tables.py form.pdf tables.json PAGE [PAGE ...]   (1-based pages)

For each page: every ruled grid pdfplumber can see (rows with top/bottom and
each row's cells x0/x1), all printed words with positions (for the header
"Page/s ___ of ___ ... signed by ... and dated" and the footer "Page___of ___"),
and every "$", "/" and checkbox glyph.

A page can carry more than one grid (Part A Table A6 has two). A grid
pdfplumber can't see (Part A Table A7 is printed slightly rotated) comes back
empty and is mapped by hand from its ruled lines (see build_parta_map.ts).
"""
import json
import sys

import pdfplumber

GLYPHS = {"$", "/", "❑", "❏"}

src, dest, pages = sys.argv[1], sys.argv[2], [int(p) for p in sys.argv[3:]]
pdf = pdfplumber.open(src)
out = {}
for pn in pages:
    p = pdf.pages[pn - 1]
    grids = []
    for t in sorted(p.find_tables(), key=lambda t: t.bbox[1]):
        if len(t.rows) < 2:
            continue
        grids.append(dict(bbox=[round(v, 2) for v in t.bbox], rows=[
            dict(top=round(r.bbox[1], 2), bot=round(r.bbox[3], 2),
                 cells=[None if c is None else [round(c[0], 2), round(c[2], 2)] for c in r.cells])
            for r in t.rows]))
    words = [dict(t=w["text"], x0=round(w["x0"], 2), top=round(w["top"], 2), x1=round(w["x1"], 2), bot=round(w["bottom"], 2))
             for w in p.extract_words()]
    glyphs = [dict(t=c["text"], x0=round(c["x0"], 2), x1=round(c["x1"], 2), top=round(c["top"], 2), bot=round(c["bottom"], 2))
              for c in p.chars if c["text"] in GLYPHS]
    out[pn] = dict(grids=grids, words=words, glyphs=glyphs)
    print(pn, "grids", [len(g["rows"]) for g in grids], "glyphs", len(glyphs))
json.dump(out, open(dest, "w"), indent=0)
