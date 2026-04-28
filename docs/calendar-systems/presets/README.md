# Calendar presets

Standalone calendar JSON definitions, paste-able into the
[PoC's JSON editor](../poc.html) for stress-testing the schema
against real-world calendar shapes.

## What's here

- **[tolkien-shire.json](./tolkien-shire.json)** — Shire Reckoning
  with intercalary blocks (Yule, Lithedays) and the Overlithe leap
  day.
- **[mayan-long-count.json](./mayan-long-count.json)** — five-tier
  vigesimal counting with the famous mixed base
  (winal = 18 kins, not 20).

## Notes

### Tolkien canon — leap rule interpretation

The Shire preset's leap rule isn't fully pinned by canon. Appendix
D of _The Lord of the Rings_ says "every fourth year except the
last of a century," but the millennium-correction clause varies by
interpretation. This preset uses the simplest reading —
`{ every: 4 }, { every: 100, exclude }` — matching Earth Gregorian
without the 400-year exception. Edit the JSON if your reading
differs.
