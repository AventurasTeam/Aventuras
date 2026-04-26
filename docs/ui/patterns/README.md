# UI patterns

Cross-cutting component and pattern specs that apply to multiple
surfaces. Sister to [`../principles.md`](../principles.md) — that
file holds philosophy and architecture-shaped rules; this directory
holds the reusable visual / interaction patterns those rules
imply.

The split exists because the principles file was accumulating
component-spec material that wasn't really philosophy. Moving it
out keeps `principles.md` focused on the "why" and lets each
pattern have its own anchor home.

When component implementation begins, Storybook's `Patterns/` tree
will mirror this directory and embed live demos. These docs stay
authoritative (greppable, versionable, IDE-readable) — Storybook
cites them, doesn't duplicate.

## Files

- [`entity.md`](./entity.md) — entity rows: indicators, kind icons,
  sort order, filter chips, three surfacing levels, schema-driven
  forms, recently-classified accent.
- [`icon-actions.md`](./icon-actions.md) — inline action icons on
  row-shaped surfaces: always-visible-muted + hover-brighten,
  shared glyph vocabulary, hidden vs disabled rules.
- [`save-sessions.md`](./save-sessions.md) — explicit-save session
  pattern (save bar + global navigate-away guard) used by every
  detail-pane edit surface.
- [`lists.md`](./lists.md) — large-list rendering rules
  (virtualization vs load-older), search bar scope.
- [`forms.md`](./forms.md) — Select primitive (segment / dropdown /
  radio render-mode rule).
- [`data.md`](./data.md) — raw JSON viewer, import counterparts
  (file-based + Vault).

## When to add to this directory

A pattern earns a slot here when it's used by **2+ surfaces** and is
component-shaped (visual treatment, interaction primitive, layout
shell) rather than philosophy. Single-surface patterns live in the
per-screen doc; design philosophy / architecture-shaped rules stay
in `principles.md`.
