# UI patterns

Cross-cutting component and pattern specs that apply to multiple
surfaces. Sister to [`../principles.md`](../principles.md) — that
file holds philosophy and architecture-shaped rules; this directory
holds the reusable visual / interaction patterns those rules imply.
The split heuristic + when-to-add rules live in
[`docs/conventions.md → Principles + patterns`](../../conventions.md#principles--patterns-when-a-domain-fans-out).

## Files

- [`entity.md`](./entity.md) — entity rows: indicators, kind icons,
  sort order, filter chips, three surfacing levels, detail-pane
  composition (hand-written per-kind), recently-classified accent.
- [`icon-actions.md`](./icon-actions.md) — inline action icons on
  row-shaped surfaces: always-visible-muted + hover-brighten,
  shared glyph vocabulary, hidden vs disabled rules.
- [`save-sessions.md`](./save-sessions.md) — explicit-save session
  pattern (save bar + global navigate-away guard) used by every
  detail-pane edit surface.
- [`lists.md`](./lists.md) — large-list rendering rules
  (virtualization vs load-older), search bar scope, empty list /
  table state + no-results state.
- [`forms.md`](./forms.md) — Select primitive (segment / dropdown /
  radio render-mode rule).
- [`overlays.md`](./overlays.md) — Sheet and Popover primitive
  contracts: rn-primitives mapping, API surface, slot reshape, story
  shapes. Consumer-side decision tree (when to use Sheet vs Popover
  vs Modal) lives in
  [`../foundations/mobile/layout.md`](../foundations/mobile/layout.md).
- [`calendar-picker.md`](./calendar-picker.md) — calendar-system
  selector shared across App Settings, Story Settings, and Wizard:
  rich rows, summary panel, swap warnings (origin / eras / display),
  edit-restrictions gating.
- [`data.md`](./data.md) — raw JSON viewer, import counterparts
  (file-based + Vault).
