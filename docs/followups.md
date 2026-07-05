# Follow-ups

Top-level ledger of **active** outstanding items — design questions
or work the current milestone (v1) needs answered, or that block
other v1 work. Resolved items are **removed** (not crossed out); the
commit that resolves an item carries the resolution narrative.

Items confirmed for a future milestone or parked indefinitely
pending signal live in [`parked.md`](./parked.md). Movement between
the two files is normal as scope clarifies; see
[`conventions.md → Followups vs parked`](./conventions.md#followups-vs-parked)
for the placement rule.

## UX

- **Smoke trigger + synthetic-story scaffolding is debug-only.**
  [Slice 1.7c](./implementation/milestones/01-spine/slices/07c-smoke.md)
  shipped a `__DEV__`-gated "Run smoke" button in the reader-composer,
  the `components/reader/smoke/` module (the `'smoke'` pipeline, its
  phase, and `runSmoke`'s synthetic story/branch bootstrap), and the
  `registerStubProvider()` dev seam in `lib/ai`. All of it is
  scaffolding flagged `TODO(spine)`; remove the module, the reader-route
  trigger, and the `lib/ai` seam when real story-creation and
  provider-settings UI land.
- **Abort-before-stream keep-vs-reverse is unresolved.** Slice 2.5's
  `submitTurn` shares one actionId between the user_action write and
  the pipeline run (C6), so a preflight failure (e.g. no narrative
  profile resolves) now reverses the user's typed turn along with
  the failed generation, not just mid-stream cancel. Whether that's
  the right UX for this specific case — as opposed to mid-stream
  cancel, which [Slice 2.7](./implementation/milestones/02-first-user-loop/slices/07-wiring.md)
  already settles as "reverse" — is still open; resolve at Slice 2.7
  planning.
- **Markdown pipeline is built but consumed by nothing — EntryCard
  renders content as plain text.** Slice 2.5's `lib/markdown`
  (`renderNarrativeHtml`/`sanitizeHtml` for web,
  `native.ts`'s `react-native-render-html` config for native) is
  fully built and tested, but `components/compounds/entry-card.tsx`
  still renders `content` via plain `<Text>` in every path (committed
  and streaming), so no markdown ever renders and the reader's
  streaming buffer feeds raw markdown rather than HTML. Wiring it in
  is a real `EntryCard` API decision (a new HTML-render path,
  platform-split web/native) that touches every kind plus the
  component's Storybook stories and `app/dev` harness — out of scope
  for a route-level integration pass and not doable narrowly, since
  `EntryCard` exposes only `content: string`. Close with a dedicated
  `EntryCard`-render task before Slice 2.5 is considered done.
