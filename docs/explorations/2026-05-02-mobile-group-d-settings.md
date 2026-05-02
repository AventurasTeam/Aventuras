# Mobile foundations — session 7 group D (settings + vault)

Per-screen retrofit pass for three of the four "settings + power-user"
surfaces:
[story-settings](../ui/screens/story-settings/story-settings.md),
[app-settings](../ui/screens/app-settings/app-settings.md), and
[vault calendars](../ui/screens/vault/calendars/calendars.md).
Fourth of four grouped consumer-pass sessions per
[`mobile/README.md → Sessions`](../ui/foundations/mobile/README.md#sessions).

The **prompt-pack editor** is the missing fourth surface — its
desktop spec hasn't landed, so there's nothing yet to retrofit.
Tracked as a post-Group-D follow-up; once the editor's desktop
design lands, the mobile expression and CodeMirror-fallback
question (per
[`mobile/README.md → Sessions`](../ui/foundations/mobile/README.md#sessions))
get their own pass.

The substrate (sessions 1–6, plus Group C's `forms.md` amendment
and the `principles.md → Tap a thumbnail to see it full-size` rule)
covers most of what these surfaces consume. **The substantive
substrate touch this group adds**: extending
[`collapse.md`](../ui/foundations/mobile/collapse.md) to formalize
left-rail-nav surfaces (story-settings, app-settings) as instances
of the same two-pane-navigation collapse pattern World and Plot
already use. Same rule, different desktop visual primitive.

## Surface inventory

| Surface         | Pre-foundations Mobile section? | Tier shape                               | Reconciliation work                                                                            |
| --------------- | ------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------- |
| story-settings  | No                              | 2-pane rail + content → list-first phone | New `## Mobile expression`; left-rail collapses to section list per the extended collapse rule |
| app-settings    | No                              | 2-pane rail + content → list-first phone | Same as story-settings                                                                         |
| vault calendars | No                              | 2-pane (Layer 0+1) + 1-pane (Layer 2)    | Hide Layer 0 rail on phone (1 active category, 3 deferred); Layer 2 reflows naturally          |
| prompt-pack ed. | Desktop spec not landed         | n/a                                      | **Out of scope this group**; lands when the editor's desktop design does                       |

Inbound anchor refs to existing mobile sections in any of the
three: zero (verified by grep on `story-settings.md#mobile`,
`app-settings.md#mobile`, `calendars.md#mobile`). No rename impact.

## Substrate touch — collapse.md two-pane navigation surfaces

The existing
[`collapse.md → World`](../ui/foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings)
section pins a clear contract: list visible by default, tap row →
detail full-screen route within the surface, back returns to list,
save-session navigate-away guard on dirty back. Plot's section
just says "same shape as World."

Settings (story-settings, app-settings) is functionally the same
shape — left rail is a navigation list, content pane is a route's
detail — even though the desktop visual primitive differs (rail
isn't a separated pane the way World/Plot's list-pane is; tabs
are grouped under uppercase section headers; no search, no filter
chips, no "+ New" footer).

Re-framing rather than duplicating:

- **Heading change**: `### World — kind selector + list + detail (master-detail)`
  becomes `### Two-pane navigation surfaces (World, Plot, Settings)`.
  The shared rule lifts out; per-surface specifics described in the
  surface's own `## Mobile expression`.
- **The rule itself is unchanged**: list visible default, tap row
  → content as inner full-screen route, back returns to list,
  save-session guard on dirty back, list-first on first mount
  unless inbound nav specified detail-route directly.
- **Per-surface variations**:
  - World/Plot: detail content has its own internal tab navigation
    (handled by the Group C tab-strip-overflow rule).
  - Settings: detail content is the section's form fields, no
    nested tab navigation.
- **Single-pane list** in `collapse.md` updates to remove
  story-settings, app-settings, vault from the "1-pane only"
  enumeration. Chapter Timeline, Story list, Onboarding, Wizard
  remain.

Vault home (Layer 0+1) doesn't fit the two-pane-nav rule cleanly
because its rail has 1 active category and 3 disabled
placeholders. **Phone-tier deviation**: hide the rail entirely on
phone for v1; route directly to the active category's content
(Calendars). When a second vault category ships, switch to the
two-pane-nav collapse rule.

Vault calendar detail (Layer 2) is single-pane (full canvas with
sections stacked vertically) — no collapse applies; phone reflows
each section naturally.

## Per-surface design

### story-settings

**Two-pane navigation collapse on phone** per the extended
[`collapse.md → Two-pane navigation surfaces`](../ui/foundations/mobile/collapse.md#two-pane-navigation-surfaces-world-plot-settings).
List state shows the section/tab list (STORY: About, Generation;
SETTINGS: Models, Memory, Translation, Pack, Calendar, Advanced)
as a scrolling vertical list with uppercase section headers as
non-tappable group separators. Tap a tab row → tab content as
inner full-screen route within the Story Settings surface; back
returns to list state.

**Top-bar shape on phone** per
[`navigation.md → Phone`](../ui/foundations/mobile/navigation.md#phone--640-px):
slim single-row `[←] [<title> / Story Settings] [pill] [⚲]`. List
state breadcrumb is `<title> / Story Settings`; detail-route
extends to `<title> / Story Settings / <tab>` (parent segments
tappable, current segment inert with tap-to-tooltip on truncation).
The `⛭` icon is absent — Story Settings IS the in-story chrome
target, so it doesn't link to itself per
[`principles.md → Settings icon scope`](../../docs/ui/principles.md#settings-icon-scope).

**Form-field rows in detail content.** All editable fields use
the existing `.field-row` 2-column grid (label / input). On phone
the label column shrinks ~30 % per the rule landed in Group C
(`world.md → Mobile expression`). Same shrink applies here for
consistency.

**Selects on phone** route per the
[`forms.md → Phone-tier dropdown surface`](../ui/patterns/forms.md#select-primitive)
amendment: dropdown render mode opens via Sheet (short) for flat
options (most enum selects), Sheet (medium) for grouped or rich
options (the model picker dropdown — already specced in
`layout.md → Surface bindings`).

**Modals stay Modal** at every tier per the existing binding
table — definitional-change confirmations (per
[`story-settings.md → Definitional-change confirmations`](../ui/screens/story-settings/story-settings.md#definitional-change-confirmations))
and the calendar-swap warnings.

**Save bar** stays at the bottom edge of the detail-route's scroll
region; hides while keyboard is open per
[`touch.md → Save bar on phone`](../ui/foundations/mobile/touch.md#save-bar-on-phone),
reappears on field blur. Navigate-away guard stays active.

**Stack-aware Return**: list ↔ detail navigation is a sub-stack
within the Story Settings surface; back from detail returns to
list, not to the prior in-story surface (reader / world / plot).
Dirty-state guard fires before the back action when the detail tab
is dirty.

**Tablet** keeps the desktop 2-pane layout. The rail is ~200 px
which fits cleanly at iPad portrait detail-pane (~568 px); no tab
strip overflow rule applies because the navigation primitive is a
left-rail list, not a horizontal tab strip.

### app-settings

Same shape as story-settings — 2-pane rail + content collapses to
list-first on phone. The differences track app-settings's data
shape, not the mobile expression.

**List state on phone** shows 10 tabs across 3 sections (GENERATION:
Providers, Profiles; STORY DEFAULTS: Memory, Translation, Composer;
APP: Appearance, Language, Data, About, Diagnostics) — same
vertical list with uppercase section headers.

**Top-bar on phone** is the app-level variant per
[`navigation.md → App-level non-root`](../ui/foundations/mobile/navigation.md#phone--640-px):
slim single-row `[←] [App Settings] [⚲]`. No `⛭` (this surface
isn't in-story; nothing for `⛭` to point to anyway). No `⚙`
(self-reference).

**Global error banner** (per
[`app-settings.md → Layout`](../ui/screens/app-settings/app-settings.md#layout))
sits above the top bar on every tier. On phone the banner copy
truncates with ellipsis if needed; the `[Open settings →]` CTA
chip stays full-tap-target.

**Provider list** uses collapsible accordion rows per the
existing desktop spec; phone reflow stacks each provider's
configuration controls vertically inside the row.

**Model picker dropdown** routes to Sheet (medium) on phone per
the existing layout binding (rich grouped list, virtualized).

**Save bar, modals, stack-aware Return**: identical to
story-settings.

### vault calendars

Two layouts, each with its own phone treatment.

**Vault home (Layer 0+1) — rail hidden on phone for v1.** Desktop
shows a 200 px rail with 1 active category (Calendars) + 3
disabled placeholders (Packs / Scenarios / Templates — all
deferred per the existing per-screen note). On phone the rail is
essentially empty navigation, so:

- **Phone**: rail hidden entirely; surface opens directly on the
  Calendars content (the only active category for v1). Top-bar
  breadcrumb reads `Vault / Calendars`.
- **When a second vault category ships**: switch to the two-pane
  navigation collapse rule (rail flattens to a list of categories,
  tap → category content as inner route).

The existing card grid (`grid-template-columns: repeat(auto-fill,
minmax(140px, 1fr))`) reflows naturally — 1 column on phone, 2
on tablet, 3+ on desktop. No special override needed.

**Filter chips** (`All | Built-in | Custom`) wrap as needed.

**`+ Add calendar ▾`** trigger opens its menu as Sheet (short) on
phone per the layout binding for popover-style menus. Three menu
options (Clone built-in / From JSON file / From scratch — disabled
placeholder).

**Vault calendar detail (Layer 2) — single-pane reflow.** Full
canvas with stacked sections (DETAIL HEAD / DEFINITION / LABELS /
DISPLAY PREVIEW / SAVE BAR). On phone:

- **Top-bar breadcrumb** truncates: `Vault / Calendars / Earth
(Gregorian)` may wrap; tap-to-tooltip per touch.md.
- **Sections stack vertically** — already the desktop layout,
  reflows naturally with narrower content widths.
- **Display preview interactive controls** may need tighter
  spacing on phone — date inputs, era flip controls — handled by
  the existing `.field-row` shrink rule.
- **Save bar** at bottom edge; hide-on-keyboard rule applies.
- **Back from Layer 2** routes to Layer 1 (Vault home / Calendars
  grid). Dirty-state guard fires before the back action.

**Modals**: Calendar swap warnings, JSON import flow, delete-
confirm — all stay Modal at every tier per the existing binding
table.

**Selects on phone**: era picker, calendar-system identifier
selectors — all flat enums, route to Sheet (short) per the
forms.md amendment.

## Adversarial pass

**Load-bearing assumption.** The two-pane-nav collapse rule
extension assumes Settings's left-rail is functionally equivalent
to World/Plot's list-pane. Verified — both serve as navigation
lists where the row determines what shows in the adjacent content
region. Differences (uppercase section headers in Settings; entity
row indicators in World/Plot) don't change the collapse mechanics.

**Edge cases.**

- **Story-settings detail tab with dirty fields** — user navigates
  to another tab via the section list. Navigate-away guard fires.
  Same as desktop's tab-switch behavior. Phone variant: back action
  is the trigger, not direct-tab-click.
- **App-settings provider configuration with errors** — global
  error banner appears at the top. On phone the banner sits above
  the slim top bar; user can tap CTA to navigate. Banner doesn't
  hide on detail-route (it's app-level chrome).
- **Vault calendar detail with dirty changes** — back from Layer 2
  fires the navigate-away guard. Confirm modal stays Modal at
  every tier.
- **Vault home with ALL categories ever active** (post-v1
  scenario) — the "rail hidden on phone" rule no longer makes
  sense. Switch to two-pane navigation collapse when the second
  category lands. Documented as a forward-looking deviation, not a
  permanent v1 special case.
- **Settings with very long tab labels** (Generation, Translation
  on story-settings; Diagnostics on app-settings) — list rows on
  phone show full label inline; no truncation needed at typical
  phone widths (~390 px). If a future tab label exceeds row
  width, standard `text-overflow: ellipsis` applies.
- **Cross-surface navigation from Settings to another surface**
  (e.g., story-settings's "Open in panel" deep-links to App
  Settings, or vice versa) — stack-aware Return handles cleanly;
  back from the destination returns to the source surface, not
  to the section list of the destination.

**Read-site impact.** No headings renamed in the Group D
per-screen docs (no `## Mobile` exists yet to rename). The
`collapse.md → World` heading rename to "Two-pane navigation
surfaces (World, Plot, Settings)" — slug change from
`world--kind-selector--list--detail-master-detail` to
`two-pane-navigation-surfaces-world-plot-settings`. Inbound refs to
the old slug:

- `docs/ui/screens/world/world.md → ## Mobile expression`
  (Group C) cites it.
- `docs/ui/screens/plot/plot.md → ## Mobile expression`
  (Group C) cites it.
- `docs/explorations/2026-05-01-mobile-collapse.md` (historical
  exploration record) cites it.
- This Group D exploration record cites it.
- `docs/ui/screens/world/world.html` comment cites it (no anchor;
  ignore).

All four md citations need updating to the new slug in the same
commit.

**Doc-integration cascades.**

- [`collapse.md → Single-pane surfaces`](../ui/foundations/mobile/collapse.md#single-pane-surfaces--no-collapse)
  enumerates "Chapter Timeline, Story Settings, Story list, Vault,
  App Settings, Onboarding, Wizard." Story Settings, App Settings,
  Vault need to come out of that list (they're now two-pane on
  desktop, collapse on phone). Chapter Timeline, Story list,
  Onboarding, Wizard remain.
- [`mobile/README.md → Sessions`](../ui/foundations/mobile/README.md#sessions)
  Group D status updates from `(pending)` to `partial-landed
2026-05-02` with a link to this exploration record. Prompt-pack
  editor remains pending (its desktop spec hasn't landed).

**Patterns adopted on a new surface.** All three Group D surfaces
already cite the relevant patterns (Select primitive, save-session,
icon-actions, raw JSON viewer for calendars). No new pattern
citations introduced. The new collapse-extension cites no new
patterns either.

**Followups in / out.**

- **In** (a new entry): prompt-pack editor mobile retrofit (blocked
  on desktop spec). Lands in `followups.md → UX` since v1 wants
  prompt packs to be usable on mobile (text editing for variable
  values at minimum).
- **Out** (none). No existing followup entry resolved by this
  group.

**Missing perspective.**

- **Phone landscape** (~700–900 px) lands in tablet tier. Settings
  surfaces keep the rail (fits at narrow tablet detail-pane after
  the ~200 px rail). Vault home keeps its 2-pane layout (rail +
  grid). No phone landscape special case.
- **Onboarding navigation away from a settings detail-route** —
  if the user is mid-edit on Story Settings → Generation tab and
  the AI-not-configured banner fires (provider errors), the banner
  navigation deep-links to App Settings. Stack-aware Return remembers
  the source. Same as desktop.
- **Cross-tab dependencies** (e.g., Memory tab's chapter threshold
  affects Calendar tab's behavior) — on phone you can't see both
  tabs at once. No different from desktop's 2-pane (only one tab
  visible there too).

**Verified vs assumed.**

- **Verified**: existing `layout.md → Surface bindings` already
  pins Story Settings as "Full-screen route on phone" with internal
  navigation; this group implements that contract via the
  list-first sub-stack pattern. No surprises. Tablet rail width
  (200 px) fits at iPad portrait detail-pane (~568 px after rail).
- **Assumed**: app-settings's accordion provider list reflows
  cleanly on phone (each provider's config sub-pane stacks
  vertically inside the expanded row). If real implementation
  finds the accordion shape unworkable at narrow widths, the
  fallback is per-provider full-screen route on phone (a third
  level of navigation depth). Defer until implementation.

## Integration plan

**Files changed.**

- [`docs/ui/foundations/mobile/collapse.md`](../ui/foundations/mobile/collapse.md)
  — rename `### World — kind selector + list + detail (master-detail)`
  to `### Two-pane navigation surfaces (World, Plot, Settings)`.
  Lift the shared rule out; keep per-surface variation notes.
  Update the `### Single-pane surfaces` enumeration to remove
  story-settings, app-settings, vault. Update the `## What this
contract pins` opening if it references the old shape.
- [`docs/ui/screens/story-settings/story-settings.md`](../ui/screens/story-settings/story-settings.md)
  — add `## Mobile expression` section before
  `## Screen-specific open questions`.
- [`docs/ui/screens/story-settings/story-settings.html`](../ui/screens/story-settings/story-settings.html)
  — viewport-toggle review-bar group; container-query phone reflow
  (rail collapses to list-first sub-stack via state toggle).
- [`docs/ui/screens/app-settings/app-settings.md`](../ui/screens/app-settings/app-settings.md)
  — add `## Mobile expression` section before
  `## Screen-specific open questions`.
- [`docs/ui/screens/app-settings/app-settings.html`](../ui/screens/app-settings/app-settings.html)
  — same retrofit as story-settings.html.
- [`docs/ui/screens/vault/calendars/calendars.md`](../ui/screens/vault/calendars/calendars.md)
  — add `## Mobile expression` section before
  `## Screen-specific open questions`.
- [`docs/ui/screens/vault/calendars/calendars.html`](../ui/screens/vault/calendars/calendars.html)
  — viewport-toggle; container-query reflow for vault home (rail
  hidden on phone) and calendar detail (vertical reflow).
- [`docs/ui/screens/world/world.md`](../ui/screens/world/world.md),
  [`docs/ui/screens/plot/plot.md`](../ui/screens/plot/plot.md) —
  Group C citations to the renamed `collapse.md` heading update to
  the new slug.
- [`docs/explorations/2026-05-01-mobile-collapse.md`](./2026-05-01-mobile-collapse.md)
  — historical exploration record, anchor-only update on the same
  inbound ref.
- [`docs/followups.md`](../followups.md)
  — add UX entry for prompt-pack editor mobile retrofit (blocked
  on desktop spec landing).
- [`docs/ui/foundations/mobile/README.md`](../ui/foundations/mobile/README.md)
  — Sessions list, mark Group D as partial-landed 2026-05-02 with
  link to this exploration record. Note prompt-pack editor still
  pending desktop spec.

**Renames.**

- `collapse.md` heading: `## World — kind selector + list + detail (master-detail)`
  (actually `### World — ...` per current depth) → `### Two-pane navigation surfaces (World, Plot, Settings)`.
  Slug change as enumerated above. 4 inbound anchor refs updated
  in this commit.

**Followups in/out.**

- **In**: prompt-pack editor mobile retrofit (blocked on desktop
  spec).
- **Out**: none.

**Patterns adopted on a new surface.** None new. story-settings,
app-settings, vault calendars all already cite Select primitive,
save-session, icon-actions, raw JSON viewer.

**Wireframes updated.** Three per-screen wireframes gain the
viewport toggle + container-query reflow. One foundations doc
(`collapse.md`) gets the heading rename + small list cleanup.

**Intentional repeated prose.** story-settings.md and
app-settings.md `## Mobile expression` sections share most prose
(same collapse mechanism, same selects/modals/save-bar bindings).
Group A/B/C accepted similar repetition between sister surfaces.
app-settings.md uses cross-references back to story-settings where
overlap is total, distinct prose only where the surface diverges
(top-bar variant, error banner, provider accordion).
