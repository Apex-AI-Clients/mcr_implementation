# ABR fixtures

Raw JSONP response bodies from abr.business.gov.au, byte-for-byte as the
register serves them — callback wrapper, `"Is Current"` key with a space in it,
ALL CAPS names and all. `.txt` rather than `.json` on purpose: these are not
valid JSON until the wrapper comes off, and calling them `.json` would invite
somebody to `JSON.parse` them directly.

Names are invented. The ABNs and ACNs are PUBLIC GOVERNMENT numbers — the
ATO (51 824 753 556), NBN Co (ABN 86 136 533 741, ACN 136 533 741) and Snowy
Hydro (ABN 17 090 574 431, ACN 090 574 431) — because the prefill tests need
numbers that pass the ABN and ACN checksums, and a made-up number that passes
could belong to a private business. They are paired with invented names on
purpose; no client's or private entity's registration details are committed
here.

The unit tests read these instead of the network, so the whole suite runs
offline and with `ABR_GUID` unset.
