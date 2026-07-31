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

## E2E runs headless by default

Invoke the suite as `pnpm test:e2e` / `pnpm test:e2e:packaged` —
never `playwright test` directly and never with your own `xvfb-run`
prefix. The scripts route through `scripts/e2e.ts`, which supplies the
virtual display and the `E2E_VIRTUAL_DISPLAY` flag that makes
`e2e/harness/launch.ts` pin Electron to X11; calling Playwright raw
opens real windows and takes the developer's focus for the length of
the run. Both halves are load-bearing — Xvfb alone does not hide
anything on a Wayland session. See
[testing.md → Virtual display](../../docs/testing.md#virtual-display).

## Fixtures build at test time

Seed into a fresh temp `userData` per run via `--user-data-dir`;
nothing binary in git. **Seeded IDs under a substitutable prefix must
be real `prefix_<uuid>`** (deterministic UUIDv5 from the mnemonic) or
turns fail on the placeholder return trip — mnemonic IDs like
`char_kael` pass `substituteIds` untouched and break silently. See
[testing.md → Fixture + seed contract](../../docs/testing.md#fixture--seed-contract).

## No `__DEV__` dependence; no `stub` provider

`__DEV__` is `false` in both E2E launch modes — `dev` serves a
static, pre-built `dist/` snapshot rather than a live dev server, so
there's no mode where it's `true` — and the `stub` provider throws
when it's false. Mock the LLM with the local HTTP server + a seeded
`openai-compatible` provider. See
[testing.md → Mock LLM](../../docs/testing.md#mock-llm).

## Close `pnpm desktop` before running the suite

The dev app holds `127.0.0.1:9222`; a suite launched alongside it fails
**every** spec in `beforeAll` with `electron.launch` timing out, reported
as `0ms` per test — which reads like a mass product failure, not a port
collision. Check `ss -tlnp | grep 9222` when launches time out, and
`pgrep -f electron/dist/main.js` for an orphan from a killed run. See
[testing.md → Launch modes](../../docs/testing.md#launch-modes).

## `dev` mode needs a rebuild to see renderer changes

Both `dev` and `packaged` E2E modes load the same `pnpm build:web`
output; neither runs `expo start`. A renderer source edit has no
effect on a `dev`-mode run until `pnpm build:web` re-runs — this
caused a real false pass in Slice 3.7a. Rebuild before trusting a
`dev`-mode result that touches renderer code. See
[testing.md → Launch modes](../../docs/testing.md#launch-modes).

## Selectors: DB first, then i18n role/name, then testID

Prefer a DB assertion; else role + accessible name resolved through
the **same i18n key** the app uses (never hardcoded English); add a
`testID` only for scope anchors, no-role targets, non-unique icon
labels, and virtualized items — per flow, no repo-wide retrofit.
Compose from `e2e/locators/` and `e2e/flows/`; never inline a raw
selector string. See
[testing.md → Selector strategy](../../docs/testing.md#selector-strategy).
