---
paths:
  - 'e2e/**'
  - '**/*.spec.ts'
  - '**/*.test.{ts,tsx}'
  - '.claude/rules/**'
---

# Testing rules

Project-scoped rules for test work. Auto-loads when Claude reads or
writes anything under `e2e/`, a `*.spec.ts`, or a `*.test.{ts,tsx}`.
The full spec lives in [`docs/testing.md`](../../docs/testing.md) —
that's the source of truth for what / how / where; this file adds
operational reminders for AI-assisted edits.

## Which layer

Put a test in the cheapest layer that can catch its regression:
unit (`lib/*` logic), component (Storybook stories), or E2E (seams —
IPC, migrations, `app://`, native modules, full pipelines). E2E
**drives through the UI and asserts against the database** — it does
not re-verify rendering or logic. See
[testing.md → Test taxonomy](../../docs/testing.md#test-taxonomy).

## E2E is desktop-only

Playwright + Electron, packaged build as the target of record.
Android is out of scope; web-only E2E is impossible (no preload → no
DB bridge → "settings corrupted"). See
[testing.md → E2E target: desktop only](../../docs/testing.md#e2e-target-desktop-only).

## Fixtures build at test time

Seed into a fresh temp `userData` per run via `--user-data-dir`;
nothing binary in git. **Seeded IDs under a substitutable prefix must
be real `prefix_<uuid>`** (deterministic UUIDv5 from the mnemonic) or
turns fail on the placeholder return trip — mnemonic IDs like
`char_kael` pass `substituteIds` untouched and break silently. See
[testing.md → Fixture + seed contract](../../docs/testing.md#fixture--seed-contract).

## No `__DEV__` dependence; no `stub` provider

`__DEV__` is `true` locally and `false` in the packaged build, and
the `stub` provider throws when it's false. Mock the LLM with the
local HTTP server + a seeded `openai-compatible` provider. See
[testing.md → Mock LLM](../../docs/testing.md#mock-llm).

## Selectors: DB first, then i18n role/name, then testID

Prefer a DB assertion; else role + accessible name resolved through
the **same i18n key** the app uses (never hardcoded English); add a
`testID` only for scope anchors, no-role targets, non-unique icon
labels, and virtualized items — per flow, no repo-wide retrofit.
Compose from `e2e/locators/` and `e2e/flows/`; never inline a raw
selector string. See
[testing.md → Selector strategy](../../docs/testing.md#selector-strategy).
