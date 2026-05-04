# Tabs primitive

Design record for the Tabs primitive — horizontal segmented
navigation between sibling sections of the same surface (entity
detail panes, plot detail panes, lore detail panes).

Context: [`component-inventory.md → Primitives — needs design`](../ui/component-inventory.md#primitives--needs-design).
Baseline scaffolded from `react-native-reusables`'s `tabs` component
([`components/ui/tabs.tsx`](../../components/ui/tabs.tsx)).

## Scope is small

The hard part — what to do at narrow widths — was already settled
in [Group C → Tab-strip overflow rule](./2026-05-01-mobile-group-c-master-detail.md#tab-strip-overflow-rule):
consumers route to either the Tabs primitive (Tab strip) OR the
Select primitive (segment / dropdown) based on tier + tab count.

| Tier    | Count ≤ 2      | Count = 3       | Count > 3       |
| ------- | -------------- | --------------- | --------------- |
| Desktop | Tab strip      | Tab strip       | Tab strip       |
| Tablet  | Tab strip      | Tab strip       | Select dropdown |
| Phone   | Select segment | Select dropdown | Select dropdown |

The Tabs primitive itself **only renders the Tab strip case**. It
never has to handle scroll, wrap, or overflow — those are
substitution decisions made at the consumer (e.g. World detail-pane
component picks the right primitive per tier × kind-tab-count
combination).

This design pass therefore covers visual contract + counts API +
baseline reshape — three small decisions, not the cross-tier
collapse story.

## Style: underline, not pill

Wireframes consistently render the tab strip with an **underline**
treatment (`border-bottom: 2px` on active, muted-to-strong color
shift on activation). The rn-reusables baseline ships **pill**
(rounded background on active).

Reshape baseline → underline. Reasoning: tabs in this app
exclusively navigate between sibling sections of the same surface
(Overview / Identity / Connections / Settings / Assets / etc.).
That semantic is "navigation between parts of the same thing,"
which underline conveys. Pill reads as "toggle between modes,"
which is the wrong affordance for sibling sections. Modes (e.g.
Plot's `[Threads | Happenings]`) already use the Select primitive's
segment branch.

Underline contract:

- **Active**: `border-bottom: 2px` in `--fg-primary`, label
  `--fg-primary` weight `font-medium`.
- **Inactive**: `border-bottom: 2px transparent`, label
  `--fg-muted`.
- **Hover (web)**: label `--fg-primary` (same as active without
  the underline). Smooth `transition-colors` per the existing
  motion tokens.
- **Disabled**: `opacity-50`, no hover response.
- **Focus-visible (web)**: ring per the project's existing
  `--focus-ring` slot.

Sentence-case label text. Wireframes show uppercase + letter-spacing
but that's wireframe decoration; the typography session
([`typography.md`](../ui/foundations/typography.md)) doesn't lock
either case for tabs, and adding uppercase / letterspacing later is
a className tweak. Ship sentence-case; revisit if visual identity
calls for it.

## Counts: optional per-tab prop

Wireframes use a small muted count after the tab label — e.g.
`Carrying 7`, `Connections 3`, `Involvements 4`. Some tabs always
have an inherent count (Connections, Involvements, Carrying,
Assets); others never do (Overview, Identity, Settings, History).

API: optional `count?: number` prop on `TabsTrigger`. When present,
renders muted-small text after the label. When absent, label
renders alone.

```tsx
<TabsTrigger value="connections" count={3}>Connections</TabsTrigger>
<TabsTrigger value="overview">Overview</TabsTrigger>
```

Visual contract:

- Count text: `text-xs text-fg-muted`, separated from label by
  4px gap.
- No formatting on the number — consumers pass `99+` style strings
  themselves if they want clamping. The primitive renders whatever
  it gets.
- Disabled-state opacity applies uniformly to label + count.

**Cross-primitive parity.** When tabs substitute to the Select
dropdown branch on phone (count > 2), option labels in the open
Select sheet should preserve the same counts so the user sees
consistent information across primitives. Consumers wire counts
through to the Select option list when building the substitution.
Documented here so it's not lost when implementing a substitution
site.

## API surface

The baseline already exports the right four parts:

- `Tabs` — `Root`, controls active tab via `value` /
  `onValueChange`.
- `TabsList` — strip container.
- `TabsTrigger` — individual tab. Reshaped: pill → underline,
  add `count?: number`.
- `TabsContent` — body container, renders only when matching tab
  is active.

No additions beyond `count`. The rn-primitives substrate
(`@rn-primitives/tabs`) handles the radix / native dispatch.

## Baseline reshape diff

Specifically what changes vs. the shipped baseline at
[`components/ui/tabs.tsx`](../../components/ui/tabs.tsx):

- **`TabsList`** — drop the `bg-muted rounded-lg p-[3px]` pill
  container. Replace with a flex row + bottom border on the strip
  itself (`border-b border-border`) so the active-tab underline
  sits flush against a continuous line.
- **`TabsTrigger`** — drop `rounded-md border border-transparent`.
  Replace active-state styling: was `bg-background … border-foreground/10`,
  now `border-b-2 border-fg-primary text-fg-primary font-medium`.
  Inactive state: `border-b-2 border-transparent text-fg-muted`.
  Add `count` prop rendering.
- **`TabsContent`** — leave as-is.
- **`Tabs`** root — leave as-is.

## Adversarial pass

- **Load-bearing assumption — tier-aware substitution lives at the
  consumer.** Risk: a consumer forgets, ships a tab strip with
  count > 3 on tablet, layout breaks. Mitigation: doc-level
  guidance in tabs.md cross-linking the Group C rule. Not a
  runtime check for v1.
- **Edge — large counts.** Connections / Involvements counts are
  unbounded by the data model. The primitive renders whatever it
  receives; consumer formats `99+` if desired. ✓
- **Edge — counts on disabled tab.** Disabled state's `opacity-50`
  applies uniformly to label + count. ✓
- **Cascade — wireframes use uppercase / letter-spacing.** Ship
  sentence-case leaves wireframes stale on this decoration detail.
  Acceptable; not layout-critical. Tracked as a follow-up if the
  typography session revisits.
- **Cascade — Select dropdown substitution + counts.** Documented
  inline so consumers don't drop the count when wiring the Select
  branch.

## Integration plan

### New canonical doc

- **`docs/ui/patterns/tabs.md`** — primitive contract distilled
  from the sections above.

### Updates to existing canonical docs

- **`docs/ui/component-inventory.md`** — move TabBar from
  Primitives — needs design to Primitives — build-ready, citing
  `patterns/tabs.md`.
- **`docs/ui/patterns/README.md`** — add `tabs.md` to the index.
- **`docs/ui/patterns/entity.md`** — anchor the tab-architecture
  reference to `tabs.md` (currently the doc describes which tabs
  exist; cite the primitive that renders them).

### Followups

- Track uppercase / letter-spacing decision against the typography
  pass — revisit if visual identity wants to lift it. Parked as
  speculative for now.

### Wireframes

No screen-level wireframe affected — wireframes already render
underline tabs (the project's de-facto pattern). The
sentence-case-vs-uppercase decoration question is wireframe-side;
actual primitive ships sentence-case.

### Storybook story shape

`Patterns/Tabs` with stories: basic 3-tab strip, with-counts (4
tabs, mixed presence), disabled tab, ThemeMatrix per-theme
contrast, KindKitchenSink (8-tab character detail-pane simulation).
