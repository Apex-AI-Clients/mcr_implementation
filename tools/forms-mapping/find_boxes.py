"""Find every fillable spot on an official form PDF.

usage: python -I find_boxes.py form.pdf geo.json

Writes, per page (0-based keys), the input boxes (b*), ruled lines (l*) and
checkbox glyphs (c*) pdfplumber can see, in PDF points measured from the TOP
of the page. Ids are numbered left column first, then top to bottom, so the
numbered overlay (number_boxes.ts) reads in the same order as the form.

Run it from a virtualenv outside the repo (pip install pdfplumber); it is a
mapping aid, not part of the app.
"""
import json
import sys

import pdfplumber

CHECK_GLYPHS = {"\u2751", "\u274f"}  # ❑ ❏

src, dest = sys.argv[1], sys.argv[2]
pdf = pdfplumber.open(src)
geo = {}
for pi, p in enumerate(pdf.pages):
    items = []
    mid = p.width / 2
    for c in p.curves + p.rects:
        if c["x1"] - c["x0"] > 20 and c["bottom"] - c["top"] > 6:
            items.append(dict(k="box", x0=c["x0"], top=c["top"], x1=c["x1"], bot=c["bottom"]))
    for ln in p.lines:
        if ln["top"] > 60 and ln["x1"] - ln["x0"] > 20 and abs(ln["bottom"] - ln["top"]) < 1:
            items.append(dict(k="line", x0=ln["x0"], top=ln["top"] - 14, x1=ln["x1"], bot=ln["top"]))
    for ch in p.chars:
        if ch["text"] in CHECK_GLYPHS:
            items.append(dict(k="chk", x0=ch["x0"], top=ch["top"], x1=ch["x1"], bot=ch["bottom"]))
    # The "/" separators printed inside date boxes: the map needs their x to
    # place DD, MM and YYYY either side of them.
    slashes = [ch for ch in p.chars if ch["text"] == "/"]
    for t in items:
        if t["k"] == "box":
            inside = [ch for ch in slashes if t["x0"] < ch["x0"] < t["x1"] and t["top"] - 2 < ch["top"] < t["bot"]]
            if inside:
                t["slashes"] = sorted(round(ch["x0"], 2) for ch in inside)
    items.sort(key=lambda t: (0 if t["x0"] < mid else 1, round(t["top"]), t["x0"]))
    for i, t in enumerate(items):
        t["id"] = f"{t['k'][0]}{i}"
        for k in ("x0", "top", "x1", "bot"):
            t[k] = round(t[k], 2)
    geo[pi] = items
json.dump(geo, open(dest, "w"), indent=0)
# Printed words with positions, to place splits (e.g. State/Postcode) from labels.
words = {pi: [dict(t=w["text"], x0=round(w["x0"], 2), top=round(w["top"], 2), x1=round(w["x1"], 2), bot=round(w["bottom"], 2))
              for w in p.extract_words()] for pi, p in enumerate(pdf.pages)}
json.dump(words, open(dest.replace(".json", "-words.json"), "w"), indent=0)
for pi, it in geo.items():
    print(pi + 1, "items", len(it), "boxes", sum(t["k"] == "box" for t in it),
          "lines", sum(t["k"] == "line" for t in it), "checks", sum(t["k"] == "chk" for t in it))
