# Documentation conventions

Pinned conventions — how we keep the docs navigable as they grow.
The [README](./README.md) is the authoritative index of what
exists; this doc is the authoritative source for **how** the docs
are organized and what rules apply.

## Structure rules

### Where files live

- **Topic at top level.** New domains (e.g. `architecture.md`,
  `data-model.md`) go at `docs/` root.
- **Subdir when a topic fans out.** As soon as a domain has 2+ files,
  create `docs/<topic>/` with a `README.md` that indexes the topic.
  Move the topic content into the subdir.
- **One screen = one directory** under `docs/ui/screens/<screen>/`.
  The directory holds the per-screen `.md` doc and its interactive
  `.html` wireframe.
- **Sub-screens** — surfaces triggered exclusively from a parent
  screen (popovers, modals, drawers — e.g. `branch-navigator/`,
  `rollback-confirm/`) — nest inside the parent's directory:
  `docs/ui/screens/<parent>/<sub>/<sub>.md` + `<sub>.html`. Same
  one-doc-one-wireframe rule, just one level deeper.

### Naming

- Kebab-case filenames (`reader-composer.md`, not `readerComposer.md`
  or `ui-reader-composer.md`).
- No category prefixes — the directory already scopes the file.
  Exception: chronological scratch directories
  (`docs/explorations/`) use a `YYYY-MM-DD-<topic>.md` prefix
  because date is the primary axis there, not topic.
- Wireframe HTML basename matches the doc basename
  (`reader-composer.md` ↔ `reader-composer.html`).

### Cross-references

- **Use markdown anchor links** for all cross-references.
  `[label](./file.md#auto-slug)`.
- Auto-slug = GitHub slugification: lowercase, spaces → dashes,
  punctuation stripped, em-dash → `--`.
- The pre-commit hook (remark-validate-links) verifies all anchors
  resolve. Broken links fail commits.
- Heading renames are breaking changes for inbound anchor links —
  treat them like function renames. Grep for inbound references and
  update in the same commit.

### Per-screen docs

Every per-screen doc opens with:

1. The wireframe link (colocated `.html`).
2. A short intro describing the screen.
3. A "Cross-cutting principles..." section listing the relevant
   principle anchors from `ui/principles.md`.
4. The body — layout, sub-components, behavior specific to this
   screen.
5. A "Screen-specific open questions" closer (if any).

### Cross-cutting vs single-surface

Content that applies to **2+ surfaces** lives in a domain's
principles doc (`ui/principles.md`). Content specific to one surface
lives in that surface's doc.

When a pattern emerges across surfaces later, **promote** it to
principles. When something stays single-surface, leave it in the
per-screen doc.

When unsure: lean cross-cutting. Demoting later is easier than
promoting under duress.

### Principles + patterns when a domain fans out

Domains with one file (currently `architecture.md`, `data-model.md`)
interleave principles + reference content in that file. Domains with
multiple files (currently `ui/`) get a dedicated `principles.md`.

When the cross-cutting material itself fans out — and especially
when component-spec content starts crowding the philosophy — split
into a sibling `patterns/` subdirectory. `principles.md` keeps the
"why" (philosophy + architecture-shaped rules); `patterns/` holds
the "how" of reusable visual / interaction primitives. The current
`ui/` domain uses both: [`ui/principles.md`](./ui/principles.md)
and [`ui/patterns/`](./ui/patterns/README.md).

The split heuristic: a section reads as **conceptual / philosophy**
(e.g. "settings architecture", "naming convention") → principles. A
section reads as **component spec** (visual treatment, interaction
primitive, layout shell — used by 2+ surfaces) → patterns.

A new pattern earns its own file in `patterns/` when (a) it is
referenced from 2+ per-screen docs OR (b) it carries enough
component-spec detail that the principles doc would lose focus.
Otherwise leave the prose where it lives.

### README.md is index only

Any `README.md` (`docs/README.md`, `docs/ui/README.md`, future subdir
READMEs) is **navigation only**. No substantive content. Keeps the
file refactorable without breaking inbound anchor links — there's
nothing to anchor to. This applies to the project root index too;
substantive structural content lives in this conventions doc.

### Followups: top-level, outstanding-only

`docs/followups.md` is the single cross-domain ledger of items
deferred from earlier work (data-model, architecture, UX). Resolved
items are **removed**, not crossed out. The commit that resolves an
item carries the resolution narrative.

### Wireframe authoring

Per-screen interactive HTML wireframes live colocated with their
`.md` doc under `docs/ui/screens/<screen>/`. Use existing wireframes
as templates — review-controls bar at top, monochrome styling,
vanilla JS only, no build/framework. Keep them low-fidelity;
pixel-fidelity decisions land in the visual-identity pass.

## Tooling

Pre-commit (`lefthook.yml`) runs:

- **prettier** — auto-formats markdown (whitespace, list markers,
  table alignment).
- **remark** — validates anchor links + relative paths + lint rules.
  `--frail` makes warnings fail.

Manual run: `pnpm lint:docs`.

Plugins configured in `package.json` → `remarkConfig`:

- `remark-validate-links` — verify cross-references resolve.
- `remark-preset-lint-recommended` — sensible defaults.
- `remark-lint-no-duplicate-headings` — anchor uniqueness.

## Common pitfalls

- **Bracketed inline phrases** (`[Classification ‖ Translation]`,
  `[A|B]`) are parsed as reference-style links by remark. Wrap in
  backticks (`` `[A|B]` ``) when you want literal brackets in prose.
- **Heading edits silently break anchors.** If you rename a heading,
  grep for inbound `#anchor-slug` references and update them.
  Pre-commit catches anything you miss.
- **README.md inside a subdir** stays an index. Don't add prose; it
  makes the file harder to refactor.

## For Claude

Two layers of project-scoped rules:

- [`CLAUDE.md`](../CLAUDE.md) at repo root — general project context
  (domain, repo layout, stack, workflow rules). Auto-loads at session
  start.
- [`.claude/rules/`](../.claude/rules/) — topic-scoped rules that
  auto-load when Claude reads files matching their `paths`
  frontmatter. Documentation rules live in
  [`.claude/rules/docs.md`](../.claude/rules/docs.md) (loads on
  `docs/**` or `.claude/rules/**`).

This doc is the source of truth for what / how / where; the
`.claude/rules/docs.md` file references it and adds operational
reminders for AI-assisted edits.
