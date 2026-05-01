# Mobile foundations — session 7 group A (entry flow)

Per-screen retrofit pass for the three "entry flow" surfaces:
[story-list](../ui/screens/story-list/story-list.md),
[wizard](../ui/screens/wizard/wizard.md), and
[onboarding](../ui/screens/onboarding/onboarding.md). First of four
grouped consumer-pass sessions per
[`mobile/README.md → Sessions`](../ui/foundations/mobile/README.md#sessions).

The substrate (sessions 1–6) already carries every contract these
three surfaces consume. This pass is **mechanical retrofit** —
adopting the responsive viewport toggle in each wireframe, wiring
container-query reflow, and adding a `## Mobile expression` section
to each per-screen `.md` that cites the foundations contracts and
calls out the surface's specific phone-tier expression. No new
foundations rules emerge; if a surface doesn't fit cleanly under the
contract, that's a contract gap and the contract gets revised, not
the surface special-cased.

## Surface inventory

All three are single-pane (no master-detail collapse rule applies).
Two are full-screen routes (wizard, onboarding) per
[`layout.md → Surface bindings`](../ui/foundations/mobile/layout.md#surface-bindings--existing-app-surfaces);
one is the app's root surface (story-list).

| Surface    | Tier shape                   | Primary primitive | Primary chrome question                    |
| ---------- | ---------------------------- | ----------------- | ------------------------------------------ |
| story-list | Single-pane grid, all tiers  | Surface (root)    | Top-bar root variant; ⋯ menu becomes Sheet |
| wizard     | Full-screen route, all tiers | Full-screen route | Top-bar grid, step pills, footer reflow    |
| onboarding | Full-screen route, all tiers | Full-screen route | Centered-card-on-backdrop → full-bleed     |

## Per-surface design

### story-list

Already responsive at the grid level — `grid-template-columns:
repeat(auto-fill, minmax(280px, 1fr))` produces 1 column at phone
(< ~300 px content area), 2 at tablet, 3–4 at desktop. The retrofit
formalizes this via the foundations container-query mechanism rather
than relying on document-width media queries.

**Top-bar.** Root surface — logo on left, no Return per
[`navigation.md → Top-bar shape`](../ui/foundations/mobile/navigation.md#top-bar-shape-across-tiers).
On phone, the `[A] Aventuras` logo+title slot compresses (smaller
icon, smaller title font); right group keeps `⚲` (Actions) and `⚙`
(App settings).

**List header row.** On phone, `[Import story…]` and
`[+ New story]` wrap below the `Stories · 6 total` title; the
two buttons stack horizontally beneath, or to two rows if even
that doesn't fit at 360 px. No FAB; minimal-translation
philosophy.

**Toolbar.** Search row, filter chips, sort picker — already
`flex-wrap: wrap`. Phone reflow lets each row break naturally;
no behavior change.

**⋯ overflow menu.** Per
[`layout.md → Surface bindings`](../ui/foundations/mobile/layout.md#surface-bindings--existing-app-surfaces),
binds to Popover on desktop / tablet, **Sheet (short) on phone**.
Same content (Archive / Edit info / Duplicate / Export / Delete);
different primitive. Mapping is mechanical — no surface-specific
edge cases.

**Pin star.** Already implements always-visible-muted (`opacity:
0.25` default, brighten on hover/focus on desktop). Touch users see
the muted star without any hover state. Per
[`touch.md → Hover translation`](../ui/foundations/mobile/touch.md#hover-translation),
this is the canonical pattern; nothing changes.

**Search-help icon popover.** Tiny content (the field-list inline);
stays Popover all tiers per
[`layout.md → Decision tree`](../ui/foundations/mobile/layout.md#decision-tree).

**Empty state.** Centered welcome card scales down on phone —
illustration ~100 px, title 18 px, body keeps line length. CTA
button stays full-width-on-phone for tap-target clarity.

**No tap-to-tooltip on cards.** Card titles truncate but cards are
tappable (tap → open story); per
[`touch.md → Tap-to-tooltip on inert chrome text`](../ui/foundations/mobile/touch.md#tap-to-tooltip-on-inert-chrome-text),
list rows / cards are explicitly out of scope (full content is
reachable via the row's normal navigation).

### wizard

Full-screen route on every tier per
[`layout.md → Surface bindings`](../ui/foundations/mobile/layout.md#surface-bindings--existing-app-surfaces).
Wizard chrome already lacks the universal top-bar (`Actions`,
Settings gear, story breadcrumb absent — wizard chrome IS the
action vocabulary), so the foundations top-bar contract doesn't
apply; the wizard's own chrome consumes the safe-area handling and
keyboard-avoidance contracts.

**Top-bar grid.** `[← Cancel]` left, `New story · step N of 5`
centered, empty right slot. Three-column grid `1fr auto 1fr` works
at every width down to 360 px (button ~85 px alongside title ~150 px,
~235 px total, fits with margin). No reflow needed, just smaller
padding and font on phone.

**Step indicator pills.** Five named pills (Frame / Calendar / World
/ Cast / Opening) overflow at 390 px — total ~510 px. Initial
decision was **horizontal scroll on phone**, preserving the named-
pill semantics. User review on the wireframe (post-aa22abc) found
horizontal-scrolled pills unworkable in practice — they read as
broken rather than scrollable. Revised decision: **collapse to
dots-only on phone** (~160 px total). The top-bar already shows
`step N of 5` textually, so the named labels are redundant on
narrow viewports; the active dot among five carries the spatial-
sense affordance without horizontal-scroll friction. Backward-
jump still works via tap on a `done` dot. The
[`wizard.md → Step indicator`](../ui/screens/wizard/wizard.md#step-indicator)
"Named-not-numbered: 5 steps fit comfortably; names give spatial
sense" framing applies to tablet and desktop; the phone tier is
the exception where labels collide with the available width.

**Step body padding.** `32px 48px` desktop → `16px 16px` phone.
Container width drives the change.

**Calendar pickrow** (`grid-template-columns: 1fr 1fr` for picker +
summary panel). On phone, **stacks vertically** — picker on top,
summary panel below. Both occupy full width.

**Calendar origin-row** — already `flex-wrap: wrap`; tier-derived
inputs wrap to multiple rows on phone naturally.

**Cast / lore row inline editor.** `row-edit-grid` (`100px 1fr
auto`) keeps three-column structure on phone — labels are short
(`Name` / `Title` / `Body` / `Voice`); the input column flexes.
Visual disclosure (`▼ Visual`, `▼ More options`) keeps content
compact when collapsed.

**Footer.** `[Save as draft] [...] [← Back] [Next →]` —
three text buttons, ~280 px total on phone with reduced padding.
Stays horizontal; padding compresses, no reflow.

**Footer keyboard-hide.** When a textarea / input field gains
focus on phone, the footer **hides** — same shape as the save-bar
behavior from
[`touch.md → Save bar on phone`](../ui/foundations/mobile/touch.md#save-bar-on-phone).
Wizard navigation buttons aren't a save bar by name, but the
keyboard-occluding shape is the same: three buttons hugging the
bottom edge that compete with composer real estate. Hide on
`keyboardDidShow`, reappear on `keyboardDidHide`. Save action
(here: `Next →` / `Save as draft`) requires keyboard dismiss
before it can be tapped — natural sequence (type → done →
advance), no surprise.

**AI-assist popover** (the `✨ Suggest <field>` guidance and result
shapes per
[`wizard.md → AI-assist pattern`](../ui/screens/wizard/wizard.md#ai-assist-pattern)).
Per
[`layout.md → Mapping`](../ui/foundations/mobile/layout.md#mapping--desktop-to-mobile),
rich popover content becomes **Sheet (bottom, medium ~50–60 %)
on phone** — the guidance input, the prose / list / chips result,
the action row, all live inside the sheet. Refine popover stacks
as a second sheet (Sheet over Sheet not allowed per
[`layout.md → Stacking`](../ui/foundations/mobile/layout.md#stacking)
— the result sheet dismisses, refine sheet replaces).

**Replace-confirm modal.** Stays Modal all tiers — short, focus-
demanding, fits Modal vocabulary verbatim.

**Calendar swap warnings.** Stay Modal all tiers (per the existing
pattern in
[`patterns/calendar-picker.md`](../ui/patterns/calendar-picker.md)
and the layout binding table).

### onboarding

Full-screen route on every tier; first launch covers the entire
viewport regardless. The desktop expression frames a
560-px-wide centered card on a dim backdrop. On phone:

- **Card becomes full-bleed.** No max-width, no margin, no shadow,
  no border-radius. The dim backdrop is invisible because the card
  covers the whole viewport. The wizard IS the chrome; on phone the
  wizard IS the screen.
- **Header padding** `28px 36px` → `16px 20px`.
- **Body padding** `28px 36px` → `16px 20px`.
- **Footer padding** `14px 24px` → `12px 16px`.

**Form rows** (Step 1: `[110px label] [control]` grid). Keep —
labels are short (`Language`, `Theme`); 110 px label alongside
~218 px control at 360 px width fits without reflow.

**Provider cards** (Step 2). Already vertical (`flex-direction:
column`); the card list is naturally phone-friendly. No change.

**Step 3 native variant.** `[API key input][Test]` — input flexes,
test button shrinks padding. Helper link ("Don't have one? Get an
API key from <Provider> →") wraps naturally below.

**Step 3 OAI-compat variant.** `[Endpoint URL]` input on its own
row, `[API key][Test]` on the next, warning callout below. All
fit at phone width with normal field-control flex behavior.

**Footer.** `[Skip for now] [foot-spacer] [Back] [Next/Finish]`
horizontal at every tier. "Skip for now" is short; padding
compresses on phone.

**Provider exit-link** (`Set up Anthropic / OpenAI / Google →`).
Long string; wraps onto two lines on phone. Acceptable.

## Adversarial pass

**Load-bearing assumption.** Container queries on the wireframe's
`.viewport` wrapper produce the same reflow at the toggle widths
that the production app produces at native viewport widths. The
foundations reference demo (`responsive.html`) already proves this
mechanism. Risk if wrong: wireframe shows a phone layout that
doesn't match a real iPhone 15 — but the breakpoint values
(< 640 / 640–1023 / ≥ 1024) match the Tailwind utility prefixes
(`sm:`, `md:`, `lg:`) the production app uses, so a mismatch would
indicate a contract bug, not a per-surface bug.

**Edge cases.**

- **Galaxy Fold cover (~360 px)**: story-list grid falls back to
  single column. Toolbar wraps. List header buttons stack. Verified
  by Tailwind alignment — `< 640` is `base` tier, no `sm:`. No
  surprise.
- **Wizard step pills at 320 px** (sub-spec phone, unsupported per
  the responsive contract): pills horizontal-scroll degrades to
  single-pill-visible-at-a-time. Acceptable; tier minimum is 320
  per responsive.md.
- **Onboarding card full-bleed at very tall phones (> 900 px
  height)**: empty space below the wizard body. Not a problem —
  background fills naturally; the wizard isn't a centered floater
  on phone.
- **Wizard step 4 cast row editor expanded with `▼ Visual` open**
  on phone: 6 sub-fields × 2 rows each = 12 rows of tall content.
  Already long on desktop; phone same shape, longer scroll. The
  inline-editor pattern is the same; no new affordance needed.
- **Replace-confirm modal during wizard step 3 on phone with
  keyboard open**: user is typing a genre body, taps Browse
  presets, picks one — fires modal. Modal layers above keyboard?
  iOS / Android behave differently; the modal's role is to
  intercept and resolve, so the focus shift dismisses keyboard
  naturally before the modal renders. Modal-over-keyboard isn't an
  edge case in practice. Verified mentally; no contract clause
  needed.

**Read-site impact.** Three per-screen docs gain a `## Mobile
expression` section, citing six foundations docs (responsive,
navigation, layout, collapse, touch, platform). No upstream doc
needs to change to support the citations.

**Doc-integration cascades.**

- **No anchor renames.** All cited foundations anchors exist as-is.
- **No new pattern adoption.** Existing patterns (icon-actions,
  forms, lists, calendar-picker) keep their existing surface
  citations; no per-screen cites a pattern it didn't already cite.
- **Wireframe convention** stays monochrome per
  [`mobile/README.md → Wireframe convention`](../ui/foundations/mobile/README.md#wireframe-convention).

**Missing perspective.**

- **Tablet-tier expression** — every retrofit decision is "tablet
  inherits desktop." Verified by
  [`navigation.md → Tablet`](../ui/foundations/mobile/navigation.md#tablet-6401023-px)
  ("Identical to desktop"). No tablet-specific surface treatment
  emerged in this group.
- **Phone landscape** (~700–900 px) is tablet-tier per
  [responsive.md](../ui/foundations/mobile/responsive.md) — same as
  iPad portrait. Wizard / onboarding / story-list at phone-landscape
  inherit the tablet-tier shape; no new design needed.
- **Accessibility per-surface labels** are out of scope for
  retrofit pass per
  [`platform.md → Out of scope for foundations`](../ui/foundations/mobile/platform.md#accessibility);
  land at implementation.

**Verified vs assumed.**

- **Verified.** Container-query mechanism (responsive.html demo);
  Tailwind tier alignment; existing CSS already responsive (story-
  list grid, calendar origin-row); ⋯ menu Sheet binding (layout.md
  table); replace-confirm modal stays Modal (layout.md table); AI
  popover → Sheet medium (layout.md mapping).
- **Assumed.** Wizard footer hides on keyboard analogously to
  save bar — extending the save-bar pattern from
  [`touch.md`](../ui/foundations/mobile/touch.md). Reasoning: the
  shape is identical (bottom-edge button row with the active
  textarea above); the user expectation is identical (don't compete
  with composer real estate); the navigate-away guard is preserved
  by the wizard's own auto-save session per
  [`wizard.md → Save / cancel / draft semantics`](../ui/screens/wizard/wizard.md#save--cancel--draft-semantics).
  If post-v1 user testing surfaces a discoverability problem on
  this analogy, the contract is open to a wizard-specific
  exception; default extends the existing rule.

## Integration plan

**Files changed.**

- [`docs/ui/screens/story-list/story-list.md`](../ui/screens/story-list/story-list.md)
  — add `## Mobile expression` section after Layout. Cite
  responsive / navigation / layout / touch.
- [`docs/ui/screens/story-list/story-list.html`](../ui/screens/story-list/story-list.html)
  — add viewport toggle review-bar group (per
  [`responsive.md → Toggle UI specification`](../ui/foundations/mobile/responsive.md#toggle-ui-specification));
  wrap surface in `.viewport` container; convert media-style rules
  to `@container` queries; phone-tier styles for top-bar / header
  buttons / toolbar wrap.
- [`docs/ui/screens/wizard/wizard.md`](../ui/screens/wizard/wizard.md)
  — add `## Mobile expression` section after Layout. Cite
  responsive / navigation / layout / touch / platform.
- [`docs/ui/screens/wizard/wizard.html`](../ui/screens/wizard/wizard.html)
  — add viewport toggle (alongside existing Step / Variant /
  Overlay groups); container queries for top-bar grid, step pills
  horizontal-scroll, step body padding, calendar pickrow stack,
  footer padding compression.
- [`docs/ui/screens/onboarding/onboarding.md`](../ui/screens/onboarding/onboarding.md)
  — add `## Mobile expression` section after Cross-cutting decisions.
  Cite responsive / layout / platform.
- [`docs/ui/screens/onboarding/onboarding.html`](../ui/screens/onboarding/onboarding.html)
  — add viewport toggle (alongside existing Step / Provider / Test
  groups); container queries for card full-bleed on phone, header /
  body / footer padding compression.
- [`docs/ui/foundations/mobile/README.md`](../ui/foundations/mobile/README.md)
  — Sessions list session 7 entry, mark Group A as landed with link
  back to this exploration record.

**Renames.** None.

**Followups in/out.** None resolved (no pre-existing followup spans
mobile retrofit on these surfaces). None introduced.

**Patterns adopted on a new surface.** None — all citations are to
foundations docs, not patterns. Existing pattern citations stay
intact.

**Wireframes updated.** Three per-screen wireframes gain the
viewport toggle and container-query reflow. One foundations file
(`mobile/README.md`) gets a session-status update.

**Intentional repeated prose.** The opening sentence of each
surface's `## Mobile expression` section follows a similar shape
("Renders per the responsive contract; specifics for this surface
below."). Surface-specific content diverges immediately. No
boilerplate concern.
