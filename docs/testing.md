# Testing

How Aventuras is tested across layers — what each layer owns, and
the end-to-end (E2E) harness that drives the real desktop app.

The **unit + component** disciplines (what to unit-test, the
Storybook/Playwright story tests, coverage posture) are specified in
[`code-conventions.md → Testing discipline`](./code-conventions.md#testing-discipline).
This doc is the source of truth for the **E2E** layer: its target,
harness structure, fixture contract, and selector strategy.

## Test taxonomy

Three layers, each owning a distinct failure class. A test belongs
to the cheapest layer that can catch its regression.

| Layer         | Runner                        | Owns                                                                          |
| ------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| **Unit**      | Vitest (`unit` project, node) | `lib/*` logic, pure functions, reducers, state machines, parsers              |
| **Component** | Vitest + Playwright (browser) | Story-driven render + interaction of `components/**` in isolation             |
| **E2E**       | Playwright + Electron         | The seams: IPC, migrations, `app://` protocol, native modules, full pipelines |

The E2E layer's unique value is the **seams between subsystems** —
renderer ↔ main IPC, on-disk SQLite with `node:sqlite` + `sqlite-vec`,
the embedder loading a real ONNX model, a pipeline run committing
deltas. It does **not** re-verify rendering (Storybook owns that) or
logic (unit owns that). The rule of thumb: **drive through the UI,
assert against the database.**

## Coverage: thorough, not exhaustive

E2E is **broad across flows, shallow within each** — it proves the
seams hold under realistic use, not that every branch is correct.

**In scope — write these:**

- **Every happy path.** The main success route through each flow —
  create a story, take a turn, install + embed, browse, classify.
- **Common alternative flows.** The routes real users hit often:
  creative-mode story (no lead, no embed), regenerate / undo a turn,
  open an existing story, resume a draft, the composer modes.
- **Common edge cases _that cross a seam_.** The boundary and failure
  states only a running app reaches: a generation failure surfacing
  the retry path, cancel mid-turn, the embedder-unavailable gate
  blocking the wizard, a turn on an opening-only branch.

**Out of scope — leave to the cheaper layers, or skip:**

- **Pure-logic branches and parser edge cases** → unit (malformed
  classifier output, id-substitution failures). Don't re-drive them
  through the packaged app.
- **Rendering variations** → Storybook.
- **Rare / pathological permutations.** Exhaustive enumeration in the
  slowest layer isn't worth the wall-clock.

**The boundary test:** an edge case earns an E2E test when it is a
flow/seam behavior the cheaper layers _can't_ reach. If unit or
Storybook can catch it, it lives there. No coverage threshold —
calibrate to how common the path is and whether a running app is the
only place the behavior is observable.

## E2E target: desktop only

E2E runs against **Electron**, packaged. Two platform decisions are
settled and load-bearing:

- **Android is out of scope.** The single-document reader pivot
  (see [`ui/patterns/reader-document.md`](./ui/patterns/reader-document.md))
  collapsed the reader onto one shared web document across platforms,
  which shrank the Android-only surface to the `expo-sqlite` driver,
  `onnxruntime-react-native`, and gesture/keyboard behavior. Those
  are covered by targeted checks, not a full E2E suite. Revisit only
  if an Android-specific regression class emerges.
- **Web-only E2E is impossible.** The plain web bundle has no
  Electron preload, so `window.aventurasDb` is absent and the very
  first `app_settings` write fails — the app degrades to a
  "settings corrupted" screen. There is no database to test against.
  E2E therefore always launches real Electron main; only _where the
  renderer HTML is served from_ varies between local and CI (below).

### Launch modes

| Mode      | Renderer source                            | Electron main | Used for                           |
| --------- | ------------------------------------------ | ------------- | ---------------------------------- |
| **Local** | static `dist/` export, served on localhost | unpackaged    | Authoring tests; fast              |
| **CI**    | `electron-builder --linux --dir` bundle    | packaged      | The suite of record; real `app://` |

Neither mode runs a Metro dev server, and **neither hot-reloads**: local
mode serves a prebuilt `dist/` through `serveDist()`, so a renderer
change is invisible to it until `pnpm build:web` runs again.

The packaged build is the target of record because it is the only
mode that exercises `app://bundle` protocol handling, asar packing,
the `asarUnpack` native modules (`sqlite-vec`, `onnxruntime-node`),
and the `extraResources` migrations — the code paths that break in
production and nowhere else.

Three launch gotchas — the first is yours to handle, the other two the
harness absorbs:

- **Neither suite builds anything.** There is no `globalSetup` and no
  pretest hook in either project, so both run whatever artifact is
  already on disk: `pnpm test:e2e:packaged` launches the binary sitting
  in `release/linux-unpacked/`, and `pnpm test:e2e` serves the `dist/`
  export plus the compiled `electron/dist/main.js`. A stale artifact
  fails **silently and selectively** — every spec predating your branch
  passes, only the newest ones fail, and the failure looks like a
  product bug rather than a build one. The tell is a locator that
  matches copy or a testID you just changed: assert against the artifact
  (`grep` the new string in `dist/`) before debugging the code. Run
  `pnpm build:web` (renderer) and `pnpm electron:compile` (main) before
  the local suite, and steps 1-3 of [CI](#ci) before the packaged one.
  CI itself is safe, because its job always builds first.
- **`firstWindow()` is unreliable in unpackaged/dev mode.** Dev-mode
  `electron/main.ts` opens a detached DevTools window that races the
  app window. Select the app window by URL prefix, not by first-open
  order. (Packaged mode has no DevTools window, so `firstWindow()` is
  safe there — but the harness selects by URL uniformly.)
- **`__DEV__` differs by mode.** It is `true` under the dev server
  and `false` in the packaged bundle. Tests must never depend on it —
  in particular the `stub` provider (`lib/ai/providers.ts`) throws
  when `__DEV__` is false, so it is unavailable to E2E. Use the mock
  LLM server instead (below).

## Harness structure

E2E lives under `e2e/`, structured so tests compose reusable pieces
and never hand-write a selector string or a launch sequence.

```
e2e/
  harness/
    launch.ts     electron.launch, --user-data-dir, window-by-URL, app.evaluate helpers
    seed.ts       build a temp userData: seed → temp DB, copy fixture embedder model
    db.ts         typed DB assertions via app.evaluate (entries, deltas, vec rows)
    i18n.ts       boot i18next once; t(key, vars) → resolved accessible-name strings
    mock-llm.ts   local HTTP server; a seeded openai-compatible provider points at it
  locators/       role/name + scope-anchor Locator factories, one file per surface
  flows/          reusable multi-step drivers (e.g. create-story-via-wizard)
  tests/          *.spec.ts — compose flows + locators + db assertions
```

`locators/` and `flows/` are the reusable-selector layer: a copy
change or a new locale propagates in one place, and a renamed i18n
key fails loudly rather than silently missing an element. Specs
import from `locators/` and `flows/`; they do not construct raw
selectors inline.

## Fixture + seed contract

Fixtures are **built at test time**, not checked in. Per run (per
worker), the harness creates a fresh temp `userData` dir, runs the
seed dataset into `<userData>/aventuras.db`, and copies a fixture
embedder model into `<userData>/embedders/` (below). `--user-data-dir`
points Electron at it, giving isolation and seeding for free —
`getDbFilePath()` resolves under `userData` (`electron/db/service.ts`),
and Electron honors the Chromium switch. Nothing binary lands in git,
and the fixture always matches the current migrations.

### Substitutable IDs must be real UUIDs

Why the fixture can't use mnemonic IDs. During a turn, `substituteIds`
(`lib/ids/substitute.ts`) walks the generation context and replaces
every entity ID that matches `ID_PATTERN` — `prefix_<uuid-shape>` for
the prefixes in `SUBSTITUTABLE_PREFIXES` (`lib/ids/prefixes.ts`) — with
a compact placeholder, so the model sees `c1` not a UUID. The
classifier / piggyback layer maps the placeholders back to UUIDs on
the return trip.

A mnemonic ID like `char_kael` does **not** match `ID_PATTERN`, so
`substituteIds` passes it through untouched and no placeholder is
allocated. Nothing errors at context-build time — which is why
browsing seeded data looks fine — but the return trip has no
placeholder to resolve and the turn fails with a malformed
placeholder.

**Contract:** every seeded ID under a substitutable prefix is a real
`prefix_<uuid>` value. `buildSeedSteps` (`lib/db/devtools/seed-dataset.ts`)
authors readable mnemonics, then a final pass (`seed-ids.ts`) rewrites
every substitutable ID to `prefix_<uuid>` — the UUID is a deterministic
pure-JS hash of the mnemonic (v4-shaped, engine-agnostic so it matches
under both the Node seed script and the Hermes reseed), so
cross-references stay wired and the fixture is byte-stable across runs
without a checked-in DB. The same pass corrects two authored off-spec
prefixes (`fac_`→`fact_`, `thread_`→`thr_`) and re-canonicalizes
character-relationship pairs whose `a_id < b_id` order the remap
inverts. Non-substitutable IDs keep readable suffixes (`br_hero_main`).
This also repaired `pnpm db:seed` for dev, unlocking
turns-on-seeded-data in the dev app.

## Embedder in E2E

The embedder is central to the story flow, so E2E exercises the real
embedding and retrieval machinery — with only the LLM mocked.

"Installed" is purely on-disk state: a model is installed when
`<userData>/embedders/<id>/` holds `model.onnx` + `meta.json`
(`electron/embedder/service.ts`), and `embed()` loads it through
transformers.js with `local_files_only: true`. So the harness seeds
a real ONNX model on disk next to the fixture DB — **no product
change, no network**. The seed dataset marks embeddings stale but
cannot populate vectors (the `vec0` tables are virtual and absent
from `dbSchema`, per `lib/db/embeddings/vec-tables.ts`); a real
embedding pass over the seeded content fills them, which is exactly
the machinery under test.

- **Model:** `Xenova/all-MiniLM-L6-v2` (384-dim), the seed's declared
  model. At ~23 MB it is too large for git — CI downloads it once
  into a cached directory (mirroring the Playwright-browser cache in
  `.github/workflows/ci.yml`); local runs reuse the dev
  `userData/embedders` when present.
- **Download flow is not E2E-tested — manual only.**
  `assertAllowedDownloadUrl` (`electron/embedder/paths.ts`) hardcodes a
  single allowed origin, so the download IPC path can't target a local
  mock without a test-only origin seam. The setup cost isn't worth the
  payoff for this one flow, so it stays a manual check; the download
  itself is verified against a real packaged build.

## Mock LLM

Provider calls route to a local HTTP server (`e2e/harness/mock-llm.ts`).
The fixture already seeds an `openai-compatible` provider; the harness
starts the mock, then `setProviderEndpoint` repoints that provider's
endpoint at the mock's URL before launch (the port is dynamic, so the
override happens at seed time, not in the dataset). This exercises the
real transport (`lib/ai/transport`) rather than bypassing it, and works
identically in local and packaged modes — unlike the `stub` provider,
which is `__DEV__`-gated and absent from the packaged build. It sends
CORS headers (and answers the preflight) because the renderer's fetch
is cross-origin.

**One endpoint, many output shapes.** A single turn fans out into
several calls on the same `…/chat/completions` URL, so the mock routes
on the request:

- **`stream: true`** → an SSE prose stream (the narrative call).
- **otherwise (structured)** → a JSON chat completion whose body is
  chosen by matching the exact TypeScript block the app injects into
  the prompt — `schemaToTypeScriptBlock` over each agent's Zod schema
  (`lib/ai/prompt-schema.ts`). Each structured agent is one
  `STRUCTURED_AGENTS` entry `{ name, block, example }`; the match
  can't drift because it reuses the app's own renderer, and tests
  override a specific agent's reply via `setStructured(name, value)`.

Two one-shot narrative controls model the boundary states a running turn
can hit: `failNextNarrative()` makes the next streaming call return HTTP
500 (the failed-turn → retriable-system-entry path), and
`holdNextNarrative()` opens the stream but holds it unfinished until
`releaseNarrative()` or a client abort — the deterministic in-flight
window the cancel spec cancels into, with no sleep-based wait.

Block-matching keys on the **auto** (prompt-injection) path the fixture
uses — the only path E2E relies on. A `force-on` profile takes the
native path instead, but the app doesn't set the openai-compatible
provider's `supportsStructuredOutputs`, so force-on currently sends
`response_format: { type: 'json_object' }` with **no schema on the
wire**; the `structured-force-on` spec pins that (and will flag it if
the provider flag is ever wired — an app followup, since native schema
output needs endpoint support and `optional`→`nullable` schemas).

Only the LLM is mocked — the pipeline, transport, entry writes, and
delta log all run for real; the `turn` and `classifier` specs assert
their effects through the DB bridge.

## Selector strategy

Three tiers, cheapest and most stable first. Reach for a lower tier
only when the one above genuinely can't express the target.

### Tier 1 — assert in the database

The strongest assertion is not in the DOM. With `app.evaluate()` into
main and a real SQLite file, verify outcomes by query: did the turn
write an entry, did the delta log record the reverse, did the
classifier tag the entity, did the embedding pass populate `vec0`.
Far more stable than any selector, and it matches the taxonomy —
the DOM drives, the DB asserts.

### Tier 2 — role + accessible name, resolved through i18n

Drive the UI by ARIA role and accessible name. The app's a11y layer
already produces disambiguated, per-instance names —
`t('storyCard.open', { title })` renders as `aria-label="Open 'My
Story'"`, unique per row. React Native Web maps `accessibilityLabel`
to `aria-label` and `accessibilityRole` to `role`. **Resolve the same
i18n key the app uses** (via `e2e/harness/i18n.ts`), never a hardcoded
English string — copy churn and locale growth then propagate for
free, and a renamed key fails loudly. Note `locales/` uses plurals
(`entries_other`, `unsavedChanges_one`), so the harness boots real
i18next rather than reading JSON naively.

### Tier 3 — testID, only where roles can't reach

`testID` maps to `data-testid` and `dataSet={{ storyId }}` to
`data-story-id` (React Native Web, hyphenated). All `components/ui`
primitives spread `...props`, so both land without touching a
primitive. Add a `testID` only for these four cases:

| Case                       | Why role + name fails                      | Convention                                      |
| -------------------------- | ------------------------------------------ | ----------------------------------------------- |
| Repeated-row scope anchor  | Need "the control _inside_ row X"          | `testID="story-card"` + `dataSet={{ storyId }}` |
| No-role assertion target   | Delta-log rows, meters — no role, no label | `testID="delta-log-row"`                        |
| Non-unique icon-only label | e.g. a shared "Collision warning" label    | `testID="collision-warning"`                    |
| Virtualized list item      | Node may be unmounted; text selector fails | `testID` + programmatic scroll                  |

`testID`s are added **per flow, as E2E reaches them** — there is no
repo-wide retrofit. Virtualization is narrow: `@tanstack/react-virtual`
/ `FlatList` appear only in `searchable-overlay-list.tsx`; the story
list and the single-document reader are fully in the DOM, so text and
role selectors are safe there.

## CI

One packaged job (`e2e`) in
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml), running on
every PR alongside `check` and `test`:

1. `pnpm build:web` — export the web bundle (~21 s).
2. `pnpm electron:compile` — compile the Electron main.
3. `pnpm exec electron-builder --linux --dir` — package unpacked,
   skipping AppImage/deb compression (~58 s locally vs ~2m38s for a
   full package). Produces the asar, unpacked native modules, and
   `extraResources` migrations the tests need. The Electron binary and
   builder downloads are cached, keyed on the lockfile.
4. `playwright install-deps chromium` — Electron's shared libraries
   (no browser download).
5. `xvfb-run -a pnpm test:e2e:packaged` (the `packaged` Playwright
   project) — Electron has no true headless mode on Linux, so it runs
   under a virtual display. The harness seeds a throwaway `userData` per run
   and launches the packaged binary against it.

The embedder model cache (for the retrieval/turn tiers) is added when
those tests land.

## Known limitations and open questions

- **CI wall-clock is estimated, not measured.** Confirm on the first
  green run; if the packaging step dominates, consider gating `e2e`
  behind `check` or caching the unpacked build.
- **Embedder download flow** is manual-only — the origin-seam setup
  isn't worth the payoff for one flow (see the embedder section).
- **`force-on` structured output doesn't put the schema on the wire.**
  The app never sets the openai-compatible provider's
  `supportsStructuredOutputs`, so a force-on profile degrades to
  schema-less `json_object`. Wiring the flag (capability-gated, with
  `optional`→`nullable` schemas) is an app followup; the
  `structured-force-on` spec pins current behavior meanwhile.
