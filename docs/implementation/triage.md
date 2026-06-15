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

### Composer-mode wrap: canonical reframe to in-code i18n

Decided in M2.6 (pack-engine) planning: composer-mode send-time wrap
(`Do` / `Say` / `Think` × `first` / `third`) is implemented in-code,
i18n-keyed, in
[Slice 2.5](./milestones/02-first-user-loop/slices/05-reader.md) — NOT
as pack/Liquid macros. The wrapped string is target-language user
content, but a pack is English-source with no per-language variant; an
in-code wrap keeps the `user-action-translation` phase fed clean
monolingual input. Slice 2.6 already dropped the wrap macros from scope.

Still needs the reframe (no single slice owns it):

- [`principles.md → Composer mode`](../ui/principles.md#composer-mode--send-time-transform-narration-aware)
  says wrapping is "driven by pack templates" — change to the in-code
  i18n model.
- [`architecture.md → Macros`](../architecture.md#macros--reusable-liquid-snippets-not-code-side-formatters)
  uses the composer wrap as a macro-as-formatter example — drop or
  recharacterize it.
- [`Milestone 2 → C2`](./milestones/02-first-user-loop/milestone.md#c2--pack-engine-render-surface)
  pins wrap macros into the pack and lists Slice 2.5 as a wrap consumer
  — remove the wrap clause; removing it likely also drops 2.5's only
  dependency on 2.6 (revisit the dep graph).

M2 is English-only (same-language short-circuit), so nothing here blocks
M2; the in-code implementation is Slice 2.5-owned and surfaces at 2.5
planning. Route the canonical reframe via aventuras-design or a focused
doc-amendment before Slice 2.5.
