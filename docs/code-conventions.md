# Code conventions

How the source tree stays consistent — module boundaries, state
placement, the action layer, component taxonomy, and the smaller
disciplines (i18n, testing, forms, package manager). Some rules are
mechanically enforced today; others are convention-only until the
tooling they depend on lands in a later slice. Each section says
which.

The operational reminder layer lives in
[`.claude/rules/code.md`](../.claude/rules/code.md) — it cites back
to the anchors here. This doc is the source of truth for the
**what** and **why**; that file adds AI-edit reminders.

## Module structure

Each subdirectory of `lib/` is a **module** — `lib/density/`,
`lib/themes/`, `lib/toast/`, and so on. A module exposes a public
API through its root `index.ts`, and that root barrel is the only
public entry. Everything else in the module is internal.

- **Inside a module, imports are free.** Files import each other by
  relative path in any direction, including across nested
  subdirectories. All of it counts as internal.
- **From outside the module, import only the root `index.ts`.** This
  applies to every importer outside the module — `app/`,
  `components/`, `hooks/`, and other `lib/` modules alike. Deep
  imports into a module's internal files are errors.
- **A nested `index.ts` is still internal.** `lib/foo/sub/index.ts`
  does not become a second public entry; outside code cannot import
  `@/lib/foo/sub`. Only the module-root barrel is public.
- **Types are part of the public API.** A deep `import type` from a
  module's internals is banned the same as a value import. Re-export
  public types from the root `index.ts`.
- **Test files follow the boundary of their location.** A test
  inside a module (`lib/foo/bar.test.ts`) is part of the module and
  deep-imports freely; a test outside `lib/` uses the public API
  like any other outside importer.
- **Build scripts are exempt.** Files under `scripts/**` run through
  `tsx` (Node) and legitimately read module internals for data and
  logic; they cannot import the React-Native-coupled public barrels.
  The rule is turned off for that path.

Top-level bare files such as `lib/utils.ts` are shared helper files,
not modules. They have no barrel and no public-API boundary — import
the named helpers directly.

Mechanically enforced by `eslint-plugin-boundaries` (v6) via the
`boundaries/dependencies` rule at `error`. Each `lib/*` folder is a
folder-mode boundaries element; the rule disallows any cross-module
import whose target is not the module's `index.ts`.

## State placement

Three tiers, narrowest first:

- **Component-local** — `useState` for state that no other component
  reads.
- **Cross-component ephemeral** — transient UI state shared across
  components (open panels, selection, hover intent) lives in
  `lib/stores/ui/`. These stores are unrestricted: read and write
  freely.
- **Domain-class Zustand stores** — the active working dataset.
  These stores expose **mutators only**. Nothing outside the store
  or the [action layer](#action-layer) calls `setState`; the store's
  namespace shape mechanically prevents it. Callers invoke named
  mutators, never poke the state directly. A store that **mirrors a
  persisted SQLite table** is the special case: it exposes read
  selectors plus hydrate and **no value-setter** — writes go through
  the action layer, which re-hydrates it (see
  [Syncing a store after a write](#syncing-a-store-after-a-write)).

SQLite remains canonical for persistent data; the Zustand tier is
the in-memory working copy.

Infrastructure `lib/*` modules that own runtime state internally —
the `lib/diagnostics` gate, the `lib/toast` queue — keep that store
**in-module**, not in `lib/stores`. The three tiers above govern the
app's domain and ephemeral-UI working set; a module's own machinery
is not a fourth tier and does not relocate to `lib/stores`.

## Action layer

A single layer spans pipeline writes and UI writes — there is no
separate "UI actions" versus "pipeline actions" split. Actions are
organized by domain under `lib/actions/<domain>/`.

The action layer mediates between Zustand and SQLite. SQLite is
canonical: the write runs in one SQLite transaction
(`runInTransaction`), and the store reflects it afterward (see
[Syncing a store after a write](#syncing-a-store-after-a-write)) —
the store update is not part of the SQLite transaction. Single-store,
memory-only mutations that touch nothing else stay inside the store
file as mutators; the action layer exists for writes that persist to
SQLite or cross stores.

### Syncing a store after a write

A store that mirrors a SQLite table stays in sync by **re-hydrating
from the DB**, not by being set directly. The action runs the write
in one SQLite transaction, then `await`s the store's hydrate
(re-read plus apply) as its last step — so by the time the action
resolves the store already reflects the write, with no stale window.
The store's content stays a pure function of the DB.

This is why a persisted-mirror store exposes **read selectors plus
hydrate, never a value-setter**. With no arbitrary-write surface the
only way the mirror changes is "reload from canonical SQLite," so no
caller can desync it from the database — the footgun of a setter that
mutates memory without persisting (silently lost on the next hydrate)
never exists to be called.

Re-hydrate is the default and, for a singleton or small row, is
effectively instant: one indexed read, a few milliseconds across the
desktop IPC bridge. A store hot enough that re-reading it per edit
shows up in a profile may apply the change optimistically instead —
but that mutator stays **package-private to the action layer**
(boundaries-lint, like a raw store handle), never reachable from a
component.

Failure handling is **not** part of this mechanism — it is a
per-store, per-context policy, and the mechanism itself carries no
default-fallback. A post-write re-hydrate **keeps the current store**
on a transient read failure (the write already committed; SQLite is
canonical, and the next hydrate reconciles). Fallback belongs only to
**boot hydration**, for the handful of stores loaded at app start,
and even there it splits by criticality: state whose loss is harmless
(a toggle whose safe default is off) may default-and-continue, while
destructive-to-lose state (app settings — providers, API keys)
**blocks at a recovery screen** rather than silently resetting.
Defaulting app settings on a failed read is an M1 stopgap until that
screen lands — don't read it as the pattern's norm.

## Component folder taxonomy

Four homes, by scope:

- **Primitives** → `components/ui/` — single semantic role.
- **Domain-agnostic compounds** → `components/compounds/` — peer
  compositions of primitives with no domain knowledge.
- **Single-domain compounds** → `components/<domain>/` — compounds
  tied to one domain (entity, story, reader, and so on).
- **Shells** → `components/shells/` — layout shells for top-level
  screen routes.

The canonical decision rule and folder anatomy live in
[Directory layout](./ui/components.md#directory-layout).

## i18n discipline

No raw user-facing strings in components. All chrome (labels,
buttons, menu items, toasts) routes through `t()`. Author copy as
translation keys, not inline literals.

Convention-only this slice. ESLint enforcement gates on `i18next`,
which installs in Slice 1.7 — until then the discipline is upheld by
review.

## Testing discipline

Unit-test the **logic**: `lib/*` modules, pure functions, reducers,
state machines, classifier output parsers. These are the surfaces
where a regression is silent and a test pays for itself.

Component behavior is verified by **UI smoke test, Storybook, or
manual** check — not by exhaustive render assertions. There are **no
coverage thresholds**; coverage is a diagnostic, not a gate.

## Forms

Input clusters with a submit button use `react-hook-form` — multi
field forms with validation and a commit step. Inline single inputs
(a rename field, a search box, a toggle row) stay component-local
with plain `useState`; pulling them into a form library buys nothing.

Convention-only this slice. `react-hook-form` installs in Slice 2.3;
until then, follow the convention and keep form clusters shaped so
the adoption is mechanical.

## pnpm and patches

pnpm is the only supported package manager. Three guards enforce it:

- `engines.pnpm` in `package.json` pins the required range.
- `engine-strict=true` in `.npmrc` turns an engine mismatch into a
  hard failure rather than a warning.
- The `only-allow` preinstall guard rejects `npm` and `yarn`
  outright.

Dependency patches live under [`patches/`](../patches/) and are
referenced from `pnpm-lock.yaml` via `patchedDependencies`. Add or
edit a patch through pnpm's patch workflow so the lockfile entry and
the patch file stay in sync; never hand-edit installed package files.

## Commenting and imports

Canonical home for both stays in
[`.claude/rules/code.md`](../.claude/rules/code.md) — not duplicated
here. See
[Commenting discipline](../.claude/rules/code.md#commenting-discipline)
and [Import wildcards](../.claude/rules/code.md#import-wildcards).

## Lessons learned

Indexed implementation pitfalls and runtime gotchas live in
[lessons-learned](./implementation/lessons-learned/README.md). Check
the index before touching the substrate an entry references — the
entries record the non-obvious failure modes that cost time the
first time around.
