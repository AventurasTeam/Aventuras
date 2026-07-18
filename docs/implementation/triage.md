# Implementation triage

Inbox for cross-cutting deferrals surfaced during implementation that
have **no single downstream slice to own them** — the items that would
otherwise be dropped straight into [`followups.md`](../followups.md) or
[`parked.md`](../parked.md) and lost.

Drop them here first. This file is a **queue, not a ledger**: an item
living here means "not yet triaged," not "deferred forever." Triage
happens as a separate pass — each item is read, then routed to its real
home (a specific slice's Open questions, the active
[`followups.md`](../followups.md) ledger, [`parked.md`](../parked.md), a
canonical spec change) or deleted if it dissolves on inspection. Keep
the queue short; a growing inbox is the signal to triage.

A deferral that a **specific downstream slice** will own does not belong
here — it goes straight into that slice's Open questions, where the
slice-planning gate forces its resolution before that slice is planned.

## Inbox

Remaining items are the post-M2 cleanup pass's second batch — triaged
as "fix now", queued only until that pass runs.

- **Wizard assist prompts hard-code their JSON schema.** The wizard-group
  templates (`WIZARD_OPENING`, `WIZARD_TITLE_CHIPS`, `WIZARD_DESCRIPTION`)
  hand-write the "Return a JSON object with these fields…" block as prose,
  while the reply is validated against a separate Zod schema
  (`openingOutputSchema` etc.). Two sources of truth that drift silently — a
  renamed or added schema field won't update the prompt. Derive the field
  list from the Zod schema instead (zod-to-json-schema, a small schema→prose
  renderer, or native structured outputs where the provider supports them).
  Surfaced by Slice 2.3.
- **Store hydrate/rehydrate seam — fold into the store namespace?** Sweep
  every store in `lib/stores/*` (`appSettingsStore`, `storiesStore`, the
  `working-set-store` factory stores, etc.) and decide a single rule: should
  `rehydrate(db)` be a **method on the store object** (`storiesStore.rehydrate(db)`)
  so the store owns its own refresh, instead of a separate free export sitting
  next to it in the barrel? Apply the answer consistently. Concrete cleanups to
  fold in while there: (1) `bootstrap.ts` inlines
  `hydrateAppSettings(() => readAppSettingsRow(ctx.db))`, which is byte-identical
  to `rehydrateAppSettings(ctx.db)` — switch boot to the convenience; (2) once it
  does, `hydrateAppSettings`(thunk) + `readAppSettingsRow` have no production
  callers, so app-settings can collapse to `appSettingsStore` +
  `rehydrateAppSettings` the way stories collapsed in 2.4 (drop the thunk + read
  from the public surface; point the boot-order test at the surviving symbol).
  Cross-cutting (stores layer + boot), no single slice owner.
- **Sweep every store for `readonly` guards on read-view types.** `storiesStore`'s
  `StoriesSnapshot` was returned from `getStories()`/fed to selectors with mutable
  `rows`/`openFailures`, so a caller could `getStories().rows.push(...)` and mutate
  store state in place — bypassing `set`, firing no subscriber notification. Fixed in
  2.4 by making the snapshot fields `readonly StoryRow[]` / `Readonly<Record<…>>`.
  Sweep `lib/stores/*` (`appSettingsStore`, the `working-set-store`
  factory stores, etc.) and apply the same guard wherever a store exposes a read view
  (getter return, selector input, public-export snapshot type): make array/record
  fields `readonly` so `.push`/`.sort`/index-assignment become compile errors at the
  call site. Array/record level is enough — deep-per-field readonly is overkill unless
  a consumer actually mutates a nested field. Cross-cutting (whole stores layer), no
  single slice owner.
