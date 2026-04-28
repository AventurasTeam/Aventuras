# Calendar systems

Design + interactive PoC for tiered-counter calendar systems —
the date-time abstraction that supports Earth and user-authored
fictional calendars.

## What's here

- **[spec.md](./spec.md)** — design doc: tiered counter primitive,
  sub-divisions, era flip semantics (`flipMode`), schema, classifier
  integration, authoring story.
- **[poc.html](./poc.html)** — single-file interactive PoC. Open in
  any modern browser. No install. Pre-loaded with Earth (Gregorian),
  Earth (BC/AD), Imperial Japan (nengō), Warhammer 40K Imperial,
  Stardate, Generic Fantasy 12×30, and a Custom skeleton for
  from-scratch authoring. Earth (BC/AD) demonstrates the
  [spec rule](./spec.md#eras-hoisted-out-manually-triggered) that
  astronomical-reference splits are handled in `displayFormat`
  (via the `era_label` Liquid filter), not the era system.
- **[presets/](./presets/README.md)** — standalone calendar JSON
  definitions paste-able into the PoC for stress-testing
  (Shire, Mayan; index + canon notes inside).
