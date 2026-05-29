# Slice 1.1 — Code conventions

## Metadata

- **Milestone:** [Milestone 1 — Spine](../milestone.md)
- **Depends on:** none (first slice)
- **Blocks:** 1.2, 1.3, 1.4, 1.5, 1.6, 1.7 — every later slice
  authors `lib/*` modules under this slice's eslint rule.

## Goal

Land the canonical project conventions and the eslint rule that
enforces the `lib/*` public-API discipline. The rule applies to
every importer outside a module — including code outside `lib/`
(app routes, components, scripts) — which can reach a module only
through its `index.ts`. Three artefacts ship together: the
`eslint-plugin-boundaries` rule at `error` severity, the canonical
`docs/code-conventions.md` human-facing doc covering the full v1
convention set (module structure, state placement, action layer,
component taxonomy, i18n, testing, forms, pnpm), and the matching
`.claude/rules/code.md` citation block that references it from
agent-facing context.

The v2 trunk already carries three foundation modules from the
mobile-foundations track — `lib/density/`, `lib/themes/`,
`lib/toast/` — so this slice also retrofits them to the discipline:
it adds the missing `index.ts` barrels and redirects every external
deep-import to the module public API. No _new_ `lib/*` module is
introduced; the first new module (`lib/db/`) ships in Slice 1.2.

## Background

Each subdirectory of `lib/` is a module: internal files import each
other freely via relative paths; any importer outside the module
reaches it only through the module's `index.ts`. "Outside the
module" includes code outside `lib/` entirely — app routes,
components, scripts — so those source roots are declared as
boundaries elements too, which is what makes the entry-point check
fire for every importer. The rule is silent on imports from files
that match no element, so leaving importers unclassified would
silently exempt them. Tests inside a module may deep-import; tests
and scripts outside use the public API only. Types are part of the
public API — deep type imports are banned the same as value imports.

V1 introduced a narrower version of this at warn-level near the end
of that codebase (`boundaries/dependencies` scoped to
`src/lib/services/*`) and never finished the migration. V2 raises
it to `'error'`, applies it to `lib/*`, and expresses index-only
entry through the plugin's `boundaries/entry-point` rule. The v2
trunk already carries three foundation modules (`density`,
`themes`, `toast`) from the mobile-foundations track; this slice
retrofits them rather than starting from an empty `lib/`.

## Required reading

- [`.claude/rules/code.md` → Import wildcards](../../../../../.claude/rules/code.md#import-wildcards)
  — existing pattern for eslint rules that enforce code
  discipline; this slice extends the same style with the
  boundaries plugin.
- [`.claude/rules/code.md` → Commenting discipline](../../../../../.claude/rules/code.md#commenting-discipline)
  — first canonical convention; this slice's `docs/code-conventions.md`
  cites rather than duplicates it.
- [`docs/conventions.md` → Cross-references](../../../../conventions.md#cross-references)
  — anchor-link convention for any new docs added in this slice.
- [`docs/implementation/lessons-learned/`](../../../lessons-learned/README.md)
  — implementation pitfalls already collected; the canonical doc
  points readers here for runtime-pattern gotchas.

## Scope: in

- Add `eslint-plugin-boundaries` (v6 — object-based selectors; the
  v1 `boundaries/dependencies` + `internalPath` shape is retired)
  and `eslint-import-resolver-typescript` to dev dependencies;
  install with `pnpm`.
- Extend `eslint.config.js`:
  - Register the `boundaries` plugin. Add an `import/resolver`
    setting (`typescript: { alwaysTryTypes: true }`) so boundaries
    resolves `@/` aliases (tsconfig maps `@/* → ./*`) and
    bare-directory imports to `index.ts`. Do not blanket-spread the
    plugin's `recommended` ruleset — it enables `element-types` /
    `no-unknown` enforcement this slice scopes out; configure
    `entry-point` à la carte.
  - Declare `boundaries/elements`: `lib-module` (pattern `lib/*`,
    mode `folder`) as the encapsulated unit, `lib-file` for bare
    top-level files (`lib/*.ts`, e.g. `utils.ts`), and a catch-all
    element for the rest of the source tree (app, components,
    hooks, electron, scripts, `.storybook`, types, constants) so no
    importer is an unmatched ("unknown") file — boundaries rules
    only check imports that originate from a known element.
  - Add `boundaries/entry-point` at `'error'` severity (this is the
    rule that does index-only enforcement; `dependencies` cannot
    restrict to a file within an element): `lib-module` targets
    allow only `index.ts`; `lib-file` and the catch-all allow `'*'`.
    Omit `importKind` on the `lib-module` allow so it covers value
    and type imports alike — deep type imports are banned the same
    as value imports.
- Bring the existing foundation modules into compliance:
  - Add `lib/density/index.ts` and `lib/themes/index.ts` barrels
    exporting each module's public API (derived from current
    consumers — e.g. `themes`, `useTheme`, `COLOR_SLOT_KEYS`,
    `Theme`, `ThemeProvider`, `contrastRatio` for `themes`).
  - Extend `lib/toast/index.ts` to also export `toastStore` (the
    `toast` API and severity types are already exported).
  - Redirect every external deep-import (~50 sites across
    `components/`, `app/`, `.storybook/`, `scripts/`, and story
    files) to the module public API. The `.native.tsx` provider
    variants must keep resolving per-platform through the barrel.
- Create `docs/code-conventions.md` covering:
  - **Module structure** — `lib/*` public-API rule (any importer
    outside the module, including code outside `lib/`, uses
    `index.ts`), internal vs external imports, test deep-import
    policy, types as part of the public API.
  - **State placement** — three-tier rule (component-local
    `useState` (React) for component-local state, cross-component
    ephemeral via `lib/stores/ui/`, domain-class Zustand stores
    exposing mutators only — no direct `setState` access from
    outside the store / action layer).
  - **Action layer** — single layer spans pipeline and UI
    writes; domain-organized (`lib/actions/<domain>/`); mediates
    Zustand and SQLite transactionally.
  - **Component folder taxonomy** — primitives → `components/ui/`;
    domain-agnostic compounds → `components/compounds/`;
    single-domain compounds → `components/<domain>/`; shells →
    `components/shells/`. Cites
    [`docs/ui/components.md → Directory layout`](../../../../ui/components.md#directory-layout).
  - **i18n discipline** — no raw user-facing strings in code; all
    chrome routes through `t()`. Convention-only this slice;
    eslint enforcement gates on `i18next` install in Slice 1.7
    (per
    [`milestone.md → Narrative`](../milestone.md#narrative--overview)).
  - **Testing discipline** — unit tests required on logic:
    `lib/*` modules, pure functions, reducers, state machines,
    classifier output parsers. UI smoke / Storybook / manual
    covers component behaviour. No coverage thresholds (they
    rot).
  - **Forms** — input clusters with a submit button use
    `react-hook-form`. Inline controlled inputs (single input
    without submit — rename, search, toggle row) stay
    component-local. Convention-only this slice; `react-hook-form`
    installs in Slice 2.3.
  - **pnpm + patches** — `pnpm` is the only supported package
    manager, enforced by `engines.pnpm` + `engine-strict=true` +
    `only-allow` preinstall guard. Patches live under
    [`patches/`](../../../../../patches/) and are referenced via
    `pnpm-lock.yaml` `patchedDependencies`.
  - **Commenting + import discipline** — citations to
    [`.claude/rules/code.md → Commenting discipline`](../../../../../.claude/rules/code.md#commenting-discipline)
    and
    [`.claude/rules/code.md → Import wildcards`](../../../../../.claude/rules/code.md#import-wildcards).
    Not duplicated; canonical home stays in `code.md` since the
    rules are agent-facing-first.
  - **Lessons-learned pointer** — link to
    [`docs/implementation/lessons-learned/`](../../../lessons-learned/README.md)
    with read-before-touching guidance.
- Extend `.claude/rules/code.md` with citing sections for every
  topic introduced in `docs/code-conventions.md` above
  (Module structure, State placement, Action layer, Component
  folder taxonomy, i18n, Testing, Forms, pnpm + patches,
  Lessons-learned). Each section is short and points to the
  canonical anchor — code.md owns Commenting + Import wildcards
  end-to-end and cites code-conventions.md for everything else.
- Update `docs/README.md` to add `code-conventions.md` to the
  `## What's here` index.
- Update `CLAUDE.md` `## Authoritative reading` to list
  `docs/code-conventions.md`.
- Update the `aventuras-*` dev skills that touch code
  (`aventuras-test-driven-development`,
  `aventuras-systematic-debugging`,
  `aventuras-receiving-code-review`,
  `aventuras-requesting-code-review`,
  `aventuras-verification-before-completion`,
  `aventuras-finishing-a-development-branch`) to cite
  `docs/code-conventions.md` in their preflight.

## Scope: out

- No _new_ `lib/*` modules. The first new module (`lib/db/`) ships
  in Slice 1.2. The existing `density` / `themes` / `toast`
  foundation modules are retrofitted here — see Scope: in.
- No policing of inter-element coupling beyond the `lib-module`
  entry-point. Non-`lib` elements are declared only so the
  entry-point check fires for their imports; which component may
  import which, or app-vs-electron boundaries, stays unrestricted
  (every non-`lib` element allows any entry point). Tightening
  those is a future slice if cross-domain coupling becomes a
  concern.
- No new lint rules beyond the boundaries entry-point. The
  `no-console` ban already landed as scaffolding (it is in
  `eslint.config.js`); the logger that gives it a real target
  ships in Slice 1.3.
- No setter-from-domain-store lint ban — lands with the action
  layer / domain stores in Slice 1.5 or 1.6 once domain stores
  exist.
- No selective-re-export shape enforcement on `index.ts` files;
  convention-only, not mechanically enforced this slice.
- No eslint rule for raw user-facing strings — gates on
  `i18next` install in Slice 1.7.
- No eslint rule for `react-hook-form` usage on submit clusters
  — `react-hook-form` doesn't install until Slice 2.3; rule
  remains a code-review-only check.
- Lessons-learned migration, CLAUDE.md non-Claude-agent pointer
  block, and pnpm enforcement (`only-allow` + `engine-strict`)
  landed as scaffolding before this slice opens — not part of
  the slice's deliverable surface, but referenced by the
  canonical doc.

## Acceptance criteria

- `eslint-plugin-boundaries` (v6) and
  `eslint-import-resolver-typescript` listed in `package.json`
  devDependencies and locked in `pnpm-lock.yaml`.
- `eslint.config.js` registers the plugin, sets the
  `import/resolver` typescript setting, declares the elements, and
  includes the `boundaries/entry-point` rule at `'error'` severity
  restricting `lib-module` imports to `index.ts`.
- `lib/density/index.ts` and `lib/themes/index.ts` exist and
  export each module's public API; `lib/toast/index.ts` also
  exports `toastStore`. No file outside a module deep-imports its
  internals.
- `docs/code-conventions.md` exists, covers Module structure,
  State placement, Action layer, Component folder taxonomy, i18n,
  Testing, Forms, pnpm + patches, Commenting / import (cites
  `code.md`), and Lessons-learned, and is listed in
  `docs/README.md` + `CLAUDE.md` `## Authoritative reading`.
- `.claude/rules/code.md` extended with citing sections for every
  topic introduced in the canonical doc; Commenting + Import
  wildcards remain end-to-end in `code.md`.
- All `aventuras-*` dev skills listed under Scope: in cite
  `docs/code-conventions.md` in their preflight.
- `pnpm lint` passes: the entry-point rule is live at `'error'`
  and the compliance refactor leaves zero violations. A deliberate
  deep-import of a module internal fails lint.
- `pnpm typecheck` passes and the existing `density` / `themes`
  vitest suites stay green after the import redirects.
- `pnpm lint:docs` passes — remark validates anchor links across
  the new and updated docs.

## Tests

No new unit tests for the plugin itself — it is upstream-tested,
and the existing `density` / `themes` vitest suites already cover
the modules' behaviour; those must stay green through the import
redirects. The rule is validated immediately and concretely: the
compliance refactor passing `pnpm lint` at `'error'` proves the
entry-point check accepts public-API imports, and a deliberate
deep-import proves it rejects internals. Cross-platform smoke
(web + native) confirms the `index.ts` barrels preserve the
`.native.tsx` provider resolution.

## Open questions

- **v6 config shape — verify against 6.x empirically.** The
  approach is fixed: `boundaries/entry-point` at `'error'`,
  `lib-module → index.ts` only, catch-all so outside-`lib/`
  importers are "known". Confirm with `pnpm lint` that (a) the
  catch-all actually makes those importers trigger the check, and
  (b) the resolver picks `index.ts` for bare-dir imports. The v6
  object-selector syntax is the live shape; the retired
  `internalPath` form must not be copied from the v1 config.
- **Import resolver.** boundaries resolves through
  `eslint-import-resolver-typescript` (currently only a transitive
  dep) plus the `import/resolver` setting. Add it as a direct dev
  dep; without it `@/`-alias and bare-dir → `index.ts` resolution
  fail and the rule misfires.
- **`.native.tsx` resolution through the barrels.** Re-exporting
  `density-provider` / `theme-provider` from `index.ts` must keep
  the bundler picking the `.native` variant on native and the base
  variant on web. Verify on both platforms.

Resolved during planning: `lib/*` mode `folder` is correct
(top-level subdirectories are modules; bare files like `utils.ts`
are a separate `lib-file` element). No synthetic `lib/_smoke/`
fixture — the existing foundation modules and the compliance
refactor exercise the rule live. Inter-element coupling stays out
of scope: non-`lib` elements are declared but allow any entry
point, so this slice does not police which component imports which;
that is a future slice if cross-domain coupling becomes a concern.
