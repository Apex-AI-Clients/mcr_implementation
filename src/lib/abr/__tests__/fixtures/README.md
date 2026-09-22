# ABR fixtures

Raw JSONP response bodies from abr.business.gov.au, byte-for-byte as the
register serves them — callback wrapper, `"Is Current"` key with a space in it,
ALL CAPS names and all. `.txt` rather than `.json` on purpose: these are not
valid JSON until the wrapper comes off, and calling them `.json` would invite
somebody to `JSON.parse` them directly.

Names, ABNs and ACNs are invented. They are shaped like the real thing (11 and
9 digits, real entity type codes) but belong to nobody — no real entity's
registration details are committed here.

The unit tests read these instead of the network, so the whole suite runs
offline and with `ABR_GUID` unset.
