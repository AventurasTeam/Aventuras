# Calendar systems

Design + interactive PoC for tiered-counter calendar systems —
the date-time abstraction that supports Earth and user-authored
fictional calendars.

## What's here

- **[spec.md](./spec.md)** — design doc: tiered counter primitive,
  sub-divisions, era flip semantics (`flipMode`), schema, classifier
  integration, authoring story.
- **[poc.html](./poc.html)** — single-file interactive PoC. Open in
  any modern browser. No install. Pre-loaded with Earth, Imperial
  Japan (nengō), Warhammer 40K Imperial, Stardate, Generic Fantasy
  12×30, and a Custom skeleton for from-scratch authoring.
- **[presets/](./presets/)** — standalone calendar JSON definitions,
  paste-able into the PoC's JSON editor for stress-testing.
  - [tolkien-shire.json](./presets/tolkien-shire.json) —
    Shire Reckoning with intercalary blocks (Yule, Lithedays) and
    the Overlithe leap day. **Canon note:** Tolkien's leap rule isn't
    fully pinned — Appendix D says "every fourth year except the last
    of a century", but the millennium-correction clause varies by
    interpretation. This preset uses `{ every: 4 }, { every: 100,
exclude }` which matches the simplest reading; edit the JSON if
    your canon differs.
  - [mayan-long-count.json](./presets/mayan-long-count.json) —
    five-tier vigesimal counting with the famous mixed base
    (winal = 18 kins, not 20).
