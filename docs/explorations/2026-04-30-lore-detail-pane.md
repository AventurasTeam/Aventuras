# Lore detail-pane composition + bundled entity-Overview gaps

Specs the World-panel lore detail-pane (the design gap left open by
[`2026-04-30-per-kind-overview-composition.md`](./2026-04-30-per-kind-overview-composition.md)
where lore was explicitly out-of-scope), the lore peek body for the
reader-composer drawer, lore list-pane sort + filter rules, and two
small entity-Overview fixes that ride along on the same cross-kind
consistency argument. Resolves the "Lore detail-pane composition"
followup (removed from `followups.md` in the integration commit).

## Background

The per-kind detail-pane composition pass landed character / location
/ item / faction. Lore was explicitly punted —
[`world.md → Lore — separate kind`](../ui/screens/world/world.md#lore--separate-kind)
holds a placeholder noting "lore's detail-pane composition is its
own design pass." The placeholder also captures the open
sub-questions: tab skeleton, body content shape, peek behavior.

Two related gaps surfaced during the design pass and bundled in:

- **Entity Overview omits `injection_mode`.** Per
  [`world.md → Tabs — per-kind composition`](../ui/screens/world/world.md#tabs--per-kind-composition),
  entity Overview shows `status`, description, per-kind glance
  fields, and tags — but not `injection_mode`. Operationally this is
  a heavy knob (`always` force-feeds every prompt; `disabled`
  excludes from retrieval entirely), and users will reach for the
  Overview to spot-check it. The same cross-kind consistency
  argument that puts a Settings tab on lore (parity with entity
  Settings) puts an injection chip on entity Overview (parity with
  the lore peek surfacing it).
- **Entity peek wireframe omits portrait.** `world.md` Overview
  composition explicitly includes a portrait slot floating
  upper-right. `reader-composer.md` declares peek body to be a
  440px-width projection of Overview. The reader-composer wireframe
  drifted — the peek body has no portrait slot. Mechanical fix; same
  pass.

Lore differs from entities in shape, not just content. Entities
carry typed `entities.state` (CharacterState / LocationState /
ItemState / FactionState — discriminated union, classifier-mutable
slots, lifecycle, scene presence). Lore carries a small set of text
fields with no lifecycle: `title`, `body`, `category`, `tags`,
`injection_mode`, `priority`. The detail-pane composition reflects
the difference — fewer tabs, simpler body shape, no Connections /
Carrying / Assets / Involvements analogs.

## Decisions

### 1. Tab skeleton — `Body | Settings | History`

Three tabs. No `Overview`, no `Carrying`, no `Connections`, no
`Assets`, no `Involvements`. Each absence is structurally justified.

| Tab             | Entities       | Lore     | Note                                                                   |
| --------------- | -------------- | -------- | ---------------------------------------------------------------------- |
| Overview        | ✓              | —        | Lore body is small enough to glance directly; no separate summary card |
| Identity / Body | ✓ (Identity)   | ✓ (Body) | Different name reflecting different content shape                      |
| Carrying        | character-only | —        | n/a                                                                    |
| Connections     | ✓              | —        | Lore doesn't reference other entities; cross-lore via body text + tags |
| Settings        | ✓              | ✓        | **Parity preserved** — operational chrome on its own tab               |
| Assets          | ✓              | —        | Parked until demand surfaces (added to `parked.md` in this pass)       |
| Involvements    | ✓              | —        | Lore isn't an actor; doesn't participate in `happening_involvements`   |
| History         | ✓              | ✓        | Parity preserved                                                       |

Settings + History parity carries the "this is a record-management
surface, not just a content editor" signal across kinds. The
asymmetry on Overview / Carrying / Connections / Involvements /
Assets reflects real shape differences, not inconsistency.

**Nomenclature.** `Body` not `Identity`. `Identity` is loaded with
"who this is" framing for entities (description + visual +
personality); lore doesn't have an identity in that sense — it has
subject matter. `Body` matches the schema field name (`lore.body`)
and reads as "the actual content of the lore entry."

### 2. Detail head — mirrors entity pattern

Per [`world.md → Detail head structure`](../ui/screens/world/world.md#detail-head-structure),
the entity detail head carries kind-icon + name + recently-classified
badge + overflow menu (⋯). The lore detail head mirrors this:

- **Breadcrumb strip**: kind-icon + "Lore"
- **Title** (inline-editable with pencil) — equivalent of the entity
  name slot. Edits dirty the save session like any field.
- **Recently-classified badge** — visible while the row is in the
  fresh or fading state per
  [`patterns/entity.md → Recently-classified row accent`](../ui/patterns/entity.md#recently-classified-row-accent).
  Lore is classifier-touched at chapter close via the lore-management
  agent (per
  [`data-model.md → Chapters / memory system`](../data-model.md#chapters--memory-system));
  the same accent rule applies.
- **Overflow menu (⋯)**: `Export lore as JSON`, `View raw JSON`,
  `Delete`. **No `Set as lead`** — lead is a character-only concept
  per [`principles → Mode, lead, and narration`](../ui/principles.md#mode-lead-and-narration--three-orthogonal-concepts).

### 3. Body tab composition

Two fields, no sub-sections.

- **Category** — single-row input at the top of the pane. Free-form
  text per the schema (`magic-system`, `religion`, `cosmology` are
  illustrative, not enumerated). On focus, a popover surfaces
  existing categories from this branch's lore as autocomplete
  suggestions, keeping casual taxonomy consistent without forcing an
  enum. Empty = `— uncategorized —` placeholder per the empty-region
  convention.
- **Body textarea** — fills the remaining vertical space. Plain
  text per the schema; no markdown rendering or rich-text in v1.
  Standard textarea grow / scroll behavior. **Body is required**
  for save (see decision 7); a non-empty body is a creation /
  edit-save invariant.

**Why category here, not Settings.** Category is content-classification
— it answers "what kind of lore is this" — and pairs naturally with
the body it labels. Settings is for operational chrome (does this
lore get injected, at what priority, what tags). Splitting category
into Settings would force a tab-switch for what's really a body-level
taxonomy edit.

**Why tags on Settings, not Body.** Tags compose with the cross-cutting
search and filter scaffolding (per
[`patterns/lists.md → search-bar-scope`](../ui/patterns/lists.md#search-bar-scope))
— they're search affordances, not content classification. Pairs with
entity Settings for cross-kind parity.

### 4. Settings tab composition

Three fields, top-down:

- **`injection_mode`** (enum select with explanation): `always` /
  `keyword_llm` (default) / `disabled`. Same select primitive
  entities use, with the same in-line explanation about how each mode
  interacts with retrieval.
  - `always` — force-injected into every prompt. Use sparingly
    (token cost).
  - `keyword_llm` — surfaced when retrieval finds keyword overlap
    with the current scene. Default.
  - `disabled` — never injected; lore is read-only reference
    material for the user.
- **`priority`** (integer input, narrow). Tooltip explains the
  working model: "Higher priority is preferred when retrieval is
  token-budget-constrained. Ties break by recency. Semantics will
  firm up alongside the retrieval-agent design pass." Default `0`.
  The tooltip is honest about the spec gap; the field is editable
  but its precise effect is gated. Open question folded into the
  existing
  [`Lore-management agent shape`](../followups.md#lore-management-agent-shape)
  followup (lore-mgmt + retrieval are paired in that followup; priority
  semantics belong there rather than spawning a sibling entry).
- **`tags`** (chip row with `+ add`): edit destination for tags
  surfaced read-only on glance / search. Same shape as entity tags.

**What's not on Settings:**

- No `status` / `retired_reason` — lore has no lifecycle.
- No `category` — content classification, not operational chrome
  (lives on Body, decision 3).

### 5. Lore peek body composition

Peek opens when any lore row is clicked in the Browse rail. The
peek-head follows the existing non-character pattern (per
[`reader-composer.md → Peek drawer — lead affordance for characters`](../ui/screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters)):
kind-icon + lore title + recently-classified badge when fresh /
fading, no lead affordance, no inline mutation.

**Peek body content (top-down, 440px width, read-only):**

- **Operational chip row** — renders only when there are non-default
  signals to surface:
  - **Injection-mode chip** when `always` or `disabled` (hidden for
    `keyword_llm` default). Subtle treatment — small uppercase label
    like `ALWAYS INJECTED` or `DISABLED`. Same chip shape lands on
    entity peek/Overview via the Overview-projection rule (decision
    8).
  - **Category chip** when set. Distinct visual treatment from the
    injection chip — content tag, not operational signal.
- **Body prose** — read-only render of `lore.body` at 440px width.
  **Truncates at ~10 visible lines** with `…` ellipsis; the foot
  link is the escalation path for full read. Empty body cannot occur
  (decision 7) so no placeholder rendering.
- **Tags chip row** — read-only mirror of the Settings `tags` field.
- **`Open in World panel →`** foot link — standard peek-foot
  affordance; routes the user to the World panel with this lore row
  selected and Body tab focused.

**Dual-rendering relationship.** The lore peek body is a read-only
projection of the **Body tab + non-default operational signals from
Settings**. Distinct from the entity dual-render (where peek =
projection of Overview), but the same single-source-design philosophy
— per-kind glance composition lives in one place; peek doesn't
restate.

**What's not on lore peek:**

- No `priority` field — peek surfaces user-actionable signals, not
  internal retrieval scaffolding. Priority's a Settings-only field.
- No inline editing — peek is read-only for non-character kinds. The
  lead-character mutation that exists on character peek-head doesn't
  apply.
- No History — log access stays on the World panel; peek body is
  content scan, not record drilldown.

### 6. List-pane sort + filter rules

**Sort order — static, two-layer:**

1. **Layer 1:** `priority` descending. Higher priority first.
2. **Layer 2 (tiebreaker):** `title` alphabetical.

No user sort controls — rule-driven and stable, mirroring the entity
sort philosophy at
[`patterns/entity.md → Entity list sort order`](../ui/patterns/entity.md#entity-list-sort-order--static-four-layer).
Applies to both Browse rail and World list pane.

Priority-as-sort-key inherits the "working model" caveat from the
priority-semantics open question. Until retrieval pins what priority
_does_, it pins what priority _means visually_ — "this lore surfaces
first in lists." If retrieval semantics later land orthogonal to
ranking, the sort still makes intuitive sense — higher priority is
"more important to the user." Doesn't need to change.

**Filter chips: none.** Lore has no orthogonal categorical axes that
warrant chip-shaped filtering — no `status` lifecycle, no in-scene
concept, free-form `category` doesn't enumerate predictably. The
list-pane filter chip row is hidden when `Lore` is the active
list-pane category. Same applies to the Browse rail when its scope
filter targets lore.

A future "categories as dynamic chips" surface — distinct
`lore.category` values rendered as filter chips — is plausible at
high lore volume but premature now. Captured in this section's
prose; no standalone followup unless real volume signals demand.

### 7. Required body — creation + edit invariant

A lore entry cannot exist with an empty `body`. Validation lives at
two places:

- **Body tab save** — save bar disables until body is non-empty.
- **Creation paths** (per [`world.md → Per-row import`](../ui/screens/world/world.md#per-row-import) /
  [`patterns/data.md → import-counterparts`](../ui/patterns/data.md#import-counterparts--file-based--vault)):
  - **Blank** — form must enforce body-non-empty before save bar
    enables.
  - **From JSON file** — Zod schema marks `body` required; mismatch
    fails the existing friendly-error path.
  - **From Vault** — vault entries already carry populated bodies
    (vault flow mostly deferred; verify when vault lands).

**`+ New lore` per-kind label.** The list-pane footer button reads
`+ New lore` when `Lore` is the active list-pane category — not
"+ New entity." Lore is not an entity; the existing button copy in
[`world.md → Per-row import`](../ui/screens/world/world.md#per-row-import)
needs to be generalized to "kind-aware" so each filter scope renders
its own `+ New <kind>` label.

### 8. Entity Overview gains non-default `injection_mode` chip

A small **injection-mode chip** lands in the Overview top region,
near the status pill. Visible only when `injection_mode` is
non-default (`always` or `disabled`); hidden for the `keyword_llm`
default.

**Why non-default-only:**

- `keyword_llm` is the system default and the most common state.
  Showing a chip on every entity at default value is visual noise.
- `always` and `disabled` are operationally consequential — both
  diverge from default behavior in opposite directions. Surfacing
  them lets users spot-check at a glance which entities are
  atypical.
- Treatment matches the precedent for `retired_reason` (visible only
  when `status === 'retired'`) — conditional surface for non-default
  operational state.

**Visual treatment.** Small uppercase chip — `ALWAYS INJECTED` or
`DISABLED`. Hover tooltip pulls from the same explanation language
used in the Settings tab select. Click on the chip routes to
Settings tab, same affordance shape as the rest of the Overview's
click-to-edit pattern.

**Peek inheritance.** Per the existing
[`reader-composer.md → Peek drawer · State-field composition`](../ui/screens/reader-composer/reader-composer.md#state-field-composition--same-as-world-panel-overview)
rule that peek body = 440px-width projection of Overview, the chip
propagates to entity peek **automatically** — no separate edit on
the peek section is needed.

### 9. Entity peek wireframe gains portrait slot

The `reader-composer.html` peek body wireframe currently renders
description prose, visual line, traits chips, drives chips, In/With,
carrying summary, tags — but no portrait. Drift from the
`world.md` Overview spec, which explicitly includes a portrait slot
floating upper-right. The peek-projection rule canonically inherits
the portrait.

**Fix.** Wireframe gains a ~80px portrait slot floating upper-right
of the peek body. Description prose wraps around it for the first
~3-4 lines, then content reflows full-width below. Empty /
unpopulated → placeholder treatment, same as Overview.

### 10. `reader-composer.md` peek-invocation wording

`reader-composer.md → Peek drawer — peek implies rail open` says
peek is "invoked only by clicking entity rows in the rail." But lore
isn't an entity, and we now spec lore peek behavior. Wording drift,
not design drift — soften "entity rows" to "rail rows" (or
equivalent neutral phrasing) so the inbound reference doesn't
contradict the new lore peek invocation.

## Adversarial summary

What we tried to break:

- **Long lore body in peek.** Truncation at ~10 lines + foot-link
  escalation handles. Peek is a scan tool, not a reading surface.
- **Empty lore.** Cannot exist (decision 7). Cleanly removes a class
  of edge cases (`always` injection on empty body, peek body empty
  rendering, etc.).
- **Cross-kind tab inconsistency.** Settings + History parity is the
  consistency anchor; absences are structurally justified, not
  inconsistencies.
- **Priority orphan-knob risk.** Tooltip is honest about the working
  model; followup tracks the open semantics. Acceptable v1 floor —
  same hedge pattern entity `lastSeenAt` carries.
- **Visual collision on entity Overview.** Status pill + injection
  chip + recently-classified badge + portrait at narrow peek width.
  Tight but not crowded — three regions / rows handle the four
  signals.
- **Overview drift.** Portrait gap surfaced and folded in. Wireframe
  catches up to spec.
- **Wording drift.** "Entity rows" inbound text caught and fixed in
  the same pass.
- **Lore-mgmt agent / category interaction.** When the agent creates
  a new lore at chapter close, what category does it set? Open. Not
  this design's scope — folds into the existing
  [`Lore-management agent shape`](../followups.md#lore-management-agent-shape)
  followup along with the priority-semantics gap.

What we did **not** verify:

- Vault-flow body-required handling (vault is mostly deferred). Will
  surface during vault implementation.
- Browse rail filter-chip visibility behavior beyond entity kinds.
  The chip row is asserted hidden when scope is lore; verification
  will land when the rail filter implementation begins.

## Integration plan

| Surface                                                | Change                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/ui/screens/world/world.md`                       | Expand `## Lore — separate kind` placeholder into full sub-sections covering tab skeleton, detail head, Body, Settings, sort, filter rules, required-body. Add `+ New <kind>` label note to Per-row import. Add non-default injection chip to entity Overview composition (each kind's top region). |
| `docs/ui/screens/reader-composer/reader-composer.md`   | Add a `### State-field composition — lore` (or equivalent) sub-section under `## Peek drawer — lead affordance for characters`, spec'ing lore peek body. Soften "entity rows" → "rail rows" in the Peek-implies-rail-open section.                                                                  |
| `docs/ui/screens/world/world.html`                     | Add lore-tab variant (`Body                                                                                                                                                                                                                                                                         | Settings | History`) to the World panel wireframe so the lore detail-pane shape is visualizable. Renders when the list-pane category filter is `Lore`. |
| `docs/ui/screens/reader-composer/reader-composer.html` | Add ~80px portrait slot floating upper-right of the entity peek body (decision 9). Add a lore-peek variant rendering the lore peek body composition (decision 5).                                                                                                                                   |
| `docs/followups.md`                                    | **Remove** `## UX → Lore detail-pane composition` entry (resolved). **Update** `## Data-model → Lore-management agent shape` to also cover the deferred `lore.priority` retrieval semantics — fold into existing entry rather than spawn a sibling.                                                 |
| `docs/parked.md`                                       | **Add** "Lore Assets" entry under `## Parked until signal → ### UX` (lore-attached images / files; revisit if real demand surfaces).                                                                                                                                                                |

**Renames:** none.

**Patterns adopted on a new surface:** none new — lore detail-pane
cites existing patterns (save-sessions, recently-classified, lists,
import-counterparts, data) but doesn't introduce a new pattern
adoption that requires Used-by updates.

**Followups resolved:** "Lore detail-pane composition" (removed
from `followups.md`).

**Followups introduced:** none new. Priority-semantics gap folds
into the existing
[Lore-management agent shape](../followups.md#lore-management-agent-shape)
entry by extending its bullet list with "lore.priority retrieval
semantics."

**Wireframes updated:**

- `world.html` — lore detail-pane shape (new tab variant).
- `reader-composer.html` — entity peek portrait slot (decision 9) +
  lore peek body variant (decision 5).

**Intentional repeated prose:** none expected. The lore section in
`world.md` and the lore peek section in `reader-composer.md` cite
each other and the canonical Body / Settings composition rather than
restating prose.
