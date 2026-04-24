# Documentation

Project documentation for Aventuras. Wireframes and design rationale
that drive UI work, schema and architectural decisions that drive
implementation, and the open questions tracked across the project.

## What's here

- **[architecture.md](./architecture.md)** — pipeline, generation
  context, agent orchestration, retrieval, translation. How code is
  organized.
- **[data-model.md](./data-model.md)** — schema, decisions, the
  `entities` / `lore` / `threads` / `happenings` shapes. What's
  stored.
- **[tech-stack.md](./tech-stack.md)** — tech choices and rationale.
- **[followups.md](./followups.md)** — top-level ledger of outstanding
  data-model, architecture, and UX items.
- **[ui/](./ui/README.md)** — UI design: principles + per-screen
  wireframes and docs.

## Structure rules

Pinned conventions — how we keep the docs navigable as they grow.

### Where files live

- **Topic at top level.** New domains (e.g. `architecture.md`,
  `data-model.md`) go at `docs/` root.
- **Subdir when a topic fans out.** As soon as a domain has 2+ files,
  create `docs/<topic>/` with a `README.md` that indexes the topic.
  Move the topic content into the subdir.
- **One screen = one directory** under `docs/ui/screens/<screen>/`.
  The directory holds the per-screen `.md` doc and its interactive
  `.html` wireframe.

### Naming

- Kebab-case filenames (`reader-composer.md`, not `readerComposer.md`
  or `ui-reader-composer.md`).
- No prefixes — the directory already scopes the file.
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

### Principles docs only when a domain fans out

Domains with one file (currently `architecture.md`, `data-model.md`)
interleave principles + reference content in that file. Domains with
multiple files (currently `ui/`) get a dedicated `principles.md`.

### README.md is index only

Any `README.md` (`docs/README.md`, `docs/ui/README.md`, future subdir
READMEs) is **navigation only**. No substantive content. Keeps the
file refactorable without breaking inbound anchor links — there's
nothing to anchor to.

### Followups: top-level, outstanding-only

`docs/followups.md` is the single cross-domain ledger of items
deferred from earlier work (data-model, architecture, UX). Resolved
items are **removed**, not crossed out. The commit that resolves an
item carries the resolution narrative.

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

Claude-scoped operational rules live in
[`.claude/CLAUDE.md`](../.claude/CLAUDE.md). They reference these
structure rules; this doc is the source of truth for what / how /
where, the Claude file adds operational reminders for AI-assisted
edits.
