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
- [`toast.md`](./toast.md) — top-anchored ephemeral notification
  primitive. Severity variants, queue cap, swipe-up dismiss + ×,
  cross-platform animation dispatch. Banners (the persistent
  counterpart) stay surface-specific.
- [`tabs.md`](./tabs.md) — horizontal segmented navigation
  primitive (underline style, optional per-tab count). Strip-only;
  consumers substitute Select at narrow tiers per the Group C rule.
- [`chips.md`](./chips.md) — Chip (square, toggleable filter / state)
  - Tag (pill, labeled content) primitives split along corner
    radius as the visual fundamental.
- [`accordion.md`](./accordion.md) — collapsible content sections.
  Strip default, card via className composition; multi-open default;
  chevron -90°→0° rotation on expand.
- [`alert-dialog.md`](./alert-dialog.md) — blocking consent gate.
  Modal-on-every-tier; rich content via composition; destructive
  CTA via Button variant (asChild). Distinct from Sheet (navigation
  surface) — AlertDialog is for "are you sure?" gates.
- [`calendar-picker.md`](./calendar-picker.md) — calendar-system
  selector shared across App Settings, Story Settings, and Wizard:
  rich rows, summary panel, swap warnings (origin / eras / display),
  edit-restrictions gating.
- [`toolbar.md`](./toolbar.md) — list-pane chrome compound: search
  with scope, filter chips, conditional sort. Cross-tier overflow
  rule (search-on-own-row at narrow tiers, single horizontal row
  at desktop). Used across Story List, World, Plot, Reader Browse
  rail.
- [`entry-card.md`](./entry-card.md) — reader-composer narrative
  row: kind-discriminated bubble (user / ai / opening / system /
  streaming) with conditional reasoning expansion, in-place edit,
  per-kind action cluster, muted world-time footer. Variable-height
  by contract; calendar-agnostic.
- [`story-card.md`](./story-card.md) — Story List grid card:
  mode-accented strip, genre overline, title with inline favorite
  star, status badges (`Draft` / `Archived`) as Chips, meta row,
  3-line description, top-right overflow menu. Documents the
  favorite-star visibility exception to icon-actions.
- [`delta-log-row.md`](./delta-log-row.md) — history-tab row:
  op-keyed badge (create / update / delete), pre-resolved target
  display name plus optional field path, host-rendered diff
  summary, source / entry-link / time meta. Used by World and
  Plot history tabs and the future global delta-log surface.
- [`data.md`](./data.md) — raw JSON viewer, import counterparts
  (file-based + Vault).
- [`embedder-download.md`](./embedder-download.md) — multi-state
  modal driving embedding-model installation (license fetch +
  presentation, download with progress, SHA256 verify, error
  variants, custom-import variant). Single component invoked from
  Onboarding · Step 4, App Settings · Embedding models · Add
  model, and Story Settings · Switch embedder. Resolves with
  `installed | declined | cancelled | error(reason)` to the host.
