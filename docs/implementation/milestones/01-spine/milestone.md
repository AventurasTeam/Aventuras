# Milestone 1: Spine

## Goal

Walking skeleton across all architectural layers of Aventuras v2.
By the end of this milestone the app boots on Electron desktop and
Android, all primary routes navigate, and a stub-LLM pipeline run
completes end-to-end — through the action layer, the logger, the
diagnostics sinks, and the database. No user-facing feature is
delivered; the goal is that the substrate is in place and the
pipeline machinery has been exercised against fault-injection
scenarios in vitest.

## Why now

First implementation milestone. Without the spine in place every
later feature would either grow against missing infrastructure or
retrofit it later, both expensive. The pipeline and memory cadence
is the load-bearing complexity of the project; exercising the
framework end-to-end with a fault-injectable stub before any
real-LLM work or memory-pipeline implementation de-risks the
architectural assumptions in `docs/architecture.md` and
`docs/generation-pipeline.md`. Landing the spine first also gives
returning contributors a worked example of each module category
before they pick up breadth work.

## Narrative / overview

The spine is built bottom-up with one exception: the code
conventions slice goes first so the rule is in place before any new
`lib/` module lands, and the pre-existing foundation modules
(`density`, `themes`, `toast`) are brought into compliance up front
rather than later. After conventions, the database layer lands as the
foundation; observability builds on it (the logger gates against
`app_settings.diagnostics.enabled`); the AI SDK wrapper layers on
top with `httpCallSink` integrated from its first emission; the
pipeline framework follows with `turnCaptureSink` and the
fault-injectable stub LLM that lets vitest exercise the machinery
without real provider traffic.

The UI half of the spine — base Zustand stores (including the
`useToasts` queue) plus empty / skeletal screens — runs in
parallel with the AI / pipeline half once the database layer is in
place. **i18n install (`i18next` + `react-i18next`) and the
`<Toaster>` mount at app root land alongside the UI shells in
slice 1.7**, so every chrome string ships translation-routed from
day one and any subsystem can fire toasts immediately — both per
the [`tech-stack.md`](../../../tech-stack.md) day-one-install
rationale (retrofitting hardcoded strings or wiring toasts later
is the tax to avoid). The two paths reconverge at the end-to-end
pipeline test: a stub LLM call triggered from UI flows through the
action layer, executes against the pipeline framework, emits
through logger + sinks, and writes a `pipeline_runs` row.

Cross-cutting decisions landed across this milestone:

- Every `lib/*` module adheres to the public-API convention; the
  `eslint-plugin-boundaries` rule lands at `error` level in 1.1,
  which also retrofits the pre-existing foundation modules, so
  every later module is built under it. The rule enforces
  index-only entry for importers outside `lib/` too.
- Logger routing is established before the AI SDK and pipeline
  slices begin, so every subsystem that needs to emit does so
  through `logger.<level>` from its first commit. Direct
  `console.*` calls outside the logger module are eslint-banned.
- The action layer is the only mutator for domain-class Zustand
  stores; UI components are read-only against them.
  Component-local state stays in `useState`; cross-component
  ephemeral state lives in `lib/stores/ui/` and is unrestricted.
  The code-conventions doc landing in Slice 1.1 codifies the
  rules.
- Pipeline transactions write to Zustand and SQLite through one
  action; rollback semantics are uniform for pipeline-side and
  UI-side writes.

What changes from "before" to "after": the app goes from "no v2
code" to "all foundational modules in place, app boots, one
pipeline round-trip works." The next milestone can pick any
user-facing feature and build it against a stable substrate.

## Slices

Slice docs land as each slice is authored (one per slice under
`./slices/`). The list below is the canonical inventory and order.

1. **Slice 1.1 — Code conventions.** `lib/*` public-API rule via
   `eslint-plugin-boundaries` (index-only entry, enforced for
   importers outside `lib/` too), the `docs/code-conventions.md`
   doc, `.claude/rules/code.md` extension citing it. Retrofits the
   pre-existing `density` / `themes` / `toast` foundation modules
   to the rule; new modules from 1.2 on are built under it.

2. **Slice 1.2 — Drizzle and minimal schema.** Tables needed by
   this milestone (including `app_settings` for diagnostics
   gating and `pipeline_runs` for pipeline ops / debug),
   migration tooling, sqlite-vec extension wiring (no vector
   schema yet). `lib/db/` lands as the first `lib/*` module.

3. **Slice 1.3 — Observability foundations.** `lib/diagnostics/`
   with the logger, the `diagnosticsStore` (logEntries slice
   only), the `LogSubsystem` union, console mirroring, and the
   `console.*` eslint ban. `httpCallSink` and `turnCaptureSink`
   are declared as empty stubs to be wired in 1.4 and 1.5.

4. **Slice 1.4 — Vercel AI SDK baseline.** Provider abstraction
   stub. `httpCallSink` wired into the HTTP wrapper with
   value-matching header redaction at the sink boundary
   (catches the API key in any header regardless of name; no
   denylist; safe for local-server short keys per
   [`observability.md → Header redaction`](../../../observability.md#header-redaction)).

5. **Slice 1.5 — Pipeline framework.** Pipeline framework itself,
   a fault-injectable stub LLM, the `turnCaptureSink`, the action
   layer scaffold, the ambient `actionId` mechanism, and a vitest
   harness exercising fault scenarios (malformed JSON, mid-stream
   timeout, refusal, cancellation).

6. **Slice 1.6 — Base Zustand stores.** `useAppSettingsStore`,
   `useGenerationStore`, navigation selection state,
   `useToasts` queue (per
   [`patterns/toast.md`](../../../ui/patterns/toast.md)).
   QueryClient setup for the React Query cache substrate.
   Action-layer wiring against domain stores.

7. **Slice 1.7 — UI shells + i18n + Toaster mount.** Empty story
   list (landing), reader-composer with existing pieces wired,
   settings screen layouts. **i18next + react-i18next install**
   with `locales/en/*` namespace skeleton — every chrome string
   in this slice routes through `t()` from day one (per
   [`tech-stack.md → i18n`](../../../tech-stack.md), specifically
   the day-one-install rule to avoid the retrofit tax).
   **`<Toaster>` mounted at app root** consuming `useToasts`
   from slice 1.6. End-to-end pipeline trigger from UI as the
   milestone's verifying smoke.

## Dependency graph

```
1.1 → 1.2 ─┬→ 1.3 ─┬→ 1.4 → 1.5
           │       │
           └→ 1.6 ─┴→ 1.7
```

- **1.1 (conventions)** is the absolute gate; every later slice
  authors `lib/*` modules against its eslint rule.
- **1.2 (schema)** gates everything downstream; observability
  reads `app_settings`, stores hydrate from tables, pipeline
  writes to `pipeline_runs`.
- **1.3 (observability)** gates 1.4 and 1.5; both subsystems
  route through the logger from their first commit.
- **1.4 (AI SDK)** gates 1.5; the pipeline framework's stub LLM
  needs the provider abstraction even when the call is faked.
- **1.6 (stores)** parallels 1.3–1.5 after 1.2; needs
  schema-shaped types but not the pipeline.
- **1.7 (UI shells)** gates on 1.6 (stores) and indirectly on
  1.5 for the end-to-end smoke trigger.

Parallel paths after 1.2: {1.3, 1.4, 1.5} on the AI / pipeline
branch runs alongside {1.6, 1.7} on the UI branch.

## Slice contracts

Slice contracts are sequencing-dominated in this milestone — each
slice's outputs become the inputs of the next on its path, and
the shape emerges from implementation rather than pre-authoring.
One exception worth pinning explicitly:

- **`LogSubsystem` union and `LogKind` template-literal type**
  ([`observability.md → Kind namespace`](../../../observability.md#kind-namespace)).
  Authored in 1.3, consumed by every later slice's logger
  emissions. The contract is pre-pinned in the canonical
  observability doc, so the milestone's job is to land the type
  and use it consistently.

The 1.4 / 1.5 boundary (what a "model call" looks like) is
sequenced: 1.4 lands, the provider-abstraction contract is fixed
by implementation, then 1.5 starts. No pre-authored contract
required.

## Definition of done

- App boots on Electron desktop and Android emulator.
- All primary routes navigable from the empty landing screen:
  landing → reader-composer → settings.
- `lib/*` public-API rule enforced at `error` level; CI fails when
  any importer deep-imports a module's internals.
- Logger writes flow into `diagnosticsStore.logEntries`; direct
  `console.*` outside the logger module is lint-banned.
- One stub-LLM pipeline run completes end-to-end: triggered from
  the reader-composer, dispatched through the action layer, runs
  through the pipeline framework against the fault-injectable
  provider stub, emits at least one `logger.warn` and one
  `httpCallSink` entry, writes a `pipeline_runs` row, populates a
  `turnCapture`.
- Vitest fault-injection scenarios for the pipeline pass:
  malformed JSON, mid-stream timeout, refusal, user cancellation.
- Storybook stories exist for every UI compound newly introduced
  in 1.7.
- Every chrome string in 1.7's empty shells routes through `t()`;
  `locales/en/*` namespace skeleton is committed.
- `<Toaster>` mounted at app root; a smoke-test toast fires from
  the end-to-end pipeline path's success or failure case.
- `httpCallSink` value-matching redaction vitest suite passes
  (raw / prefixed / query-string / short-key cases per slice
  1.4).
- Pre-commit (lefthook → prettier → remark → eslint) green on
  every slice's PR.

## Open questions

- **Action-layer internal folder structure under `lib/actions/`.**
  Domain split is the agreed shape (`lib/actions/<domain>/`);
  concrete domain names TBD when slice 1.5 authors the scaffold.
  Resolved in slice 1.5 rather than the milestone.
- **Cross-component ephemeral store inventory.** The
  `lib/stores/ui/` folder may end up holding only a handful of
  stores; the exact set emerges from 1.7 (UI shells). Not a
  milestone-level blocker.
- **End-to-end smoke trigger surface in the reader-composer.**
  The reader-composer's existing pieces don't include a "trigger
  generation" button; slice 1.7 decides whether a temporary
  trigger lands at the bottom of the composer or as a debug-mode
  affordance. Removable before milestone 2 if production design
  supersedes it.
