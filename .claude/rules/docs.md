---
paths:
  - 'docs/**'
  - '.claude/rules/**'
---

# Documentation rules

Project-scoped Claude rules for documentation work. Auto-loads when
Claude reads anything under `docs/` or `.claude/rules/`. The full
human-facing structure rules live in
[`docs/README.md`](../../docs/README.md) — that's the source of
truth; this file adds operational reminders for AI-assisted edits.

## Documentation conventions

When adding to or editing docs:

- Follow the structure rules in `docs/README.md`. They're pinned for
  a reason.
- **Use anchor links** for all cross-references between docs:
  `[label](./file.md#anchor-slug)`. Pre-commit (remark-validate-links)
  fails commits with broken anchors. No prose-style references like
  `see file.md → "Section"` for clickable cross-refs.
- **Heading stability**: if you rename a heading, grep for inbound
  anchor refs and update them in the same commit.
- **Bracketed inline text**: prose containing `[A|B]` or
  `[Classification ‖ Translation]` is parsed as reference-style
  links. Wrap in backticks (`` `[A|B]` ``).
- **Moving doc files**: use `git mv` to preserve history. Update all
  inbound path references in the same commit.

## followups.md hygiene

`docs/followups.md` is **outstanding-only**. When resolving an item:

1. Add the resolution detail to the canonical doc (`data-model.md`,
   `architecture.md`, the relevant per-screen `.md`, etc.).
2. Remove the corresponding entry from `followups.md`.
3. Carry the resolution narrative in the commit message.

When a session surfaces a new deferral, add a section to
`followups.md` under the appropriate domain (Data-model / UX /
Deferred sessions / etc.).

## Wireframes

Per-screen interactive HTML wireframes live colocated with their
`.md` doc under `docs/ui/screens/<screen>/`. Use existing wireframes
as templates — review-controls bar at top, monochrome styling, vanilla
JS only, no build/framework. Keep them low-fidelity; pixel-fidelity
decisions land in the visual identity session.

## Doc-tooling reminders

- `pnpm lint:docs` runs remark over the whole `docs/` tree manually.
  Useful before staging large doc changes.
- The `remarkConfig` lives in `package.json`. New plugins go there.
- Pre-commit runs prettier (formats markdown) before remark
  (validates). If prettier reformats and remark complains about the
  reformatted output, the validate-links plugin's frontmatter is the
  most likely lever (e.g. `repository: false`).
