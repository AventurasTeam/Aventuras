# Explorations

Dated session records — design discussions captured before
integrating into canonical docs. Each file is a frozen snapshot of
what was decided in that session, plus the trade-offs considered;
once the design lands in `data-model.md` / `architecture.md` /
`ui/`, the canonical doc carries the authoritative version and
this file remains as a historical record.

Filenames are `YYYY-MM-DD-<topic>.md`. The date prefix is the
intentional exception to the project's no-prefix naming rule (see
[../README.md → Naming](../README.md)) — chronological order is
the primary axis here.

## What's here

- [`2026-04-27-calendar-data-model-implications.md`](./2026-04-27-calendar-data-model-implications.md)
  — schema decisions for the calendar primitive's data-model
  integration (universal seconds, `vault_calendars` storage,
  `worldTimeOrigin` shape).
- [`2026-04-27-edit-restrictions-during-generation.md`](./2026-04-27-edit-restrictions-during-generation.md)
  — pipeline-gating behavior for in-flight generation: which
  surfaces lock, which stay live, why `× cancel` is the only
  always-available out.
- [`2026-04-28-calendar-picker.md`](./2026-04-28-calendar-picker.md)
  — shared calendar-picker primitive used by Story Settings, App
  Settings · Story Defaults, and Vault. Trade-offs for inline vs
  modal vs combobox.
- [`2026-04-28-era-flip-affordance.md`](./2026-04-28-era-flip-affordance.md)
  — design for surfacing era flips in the reader chrome and the
  branch-scoped flip list in Story Settings · Calendar.
- [`2026-04-28-in-story-top-bar-and-settings-routing.md`](./2026-04-28-in-story-top-bar-and-settings-routing.md)
  — three-tier in-story chrome shape + Settings-icon scope rule
  - stack-aware Return.
- [`2026-04-30-reader-scroll-polish.md`](./2026-04-30-reader-scroll-polish.md)
  — reader / composer scroll behavior: single-window model with
  swap-on-jump and auto-load-on-boundary, autoscroll engage /
  disengage / re-engage rules, jump-to-top + jump-to-bottom
  affordances with App Settings toggle for the optional top button.

## When to write one

Sessions that produce a non-trivial design and warrant a written
trail before integration. Quick fixes, lint sweeps, and small
edits go straight into canonical docs without an exploration
record.

## When to delete

These records are kept as historical reasoning. They don't get
deleted on canonical-doc landing; they get superseded — the
canonical doc is authoritative, the exploration captures how we
got there. If a record is provably obsolete (the design was
abandoned, not just superseded), it can be removed with a commit
message that explains why.
