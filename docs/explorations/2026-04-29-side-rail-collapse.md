# Side rail collapse / expand — reader-composer

Specs the right-side Browse rail's collapse / expand behavior on
the reader / composer screen. Resolves the "Side rail collapse /
expand" item from `user-notes.local.md`.

## Background

The reader / composer's right-side Browse rail eats roughly the
right third of the viewport (300px against an `1fr` narrative
column per the
[wireframe layout](../ui/screens/reader-composer/reader-composer.html)).
Two daily annoyances:

- **Reading width.** During pure reading — no active browsing —
  the rail competes with prose for horizontal space.
- **Declutter.** Filter chips, search, list churn pull attention
  away from the narrative when the user isn't actively browsing.

A third concern is **responsivity**: small Electron windows
(when the user shrinks the desktop chrome) cramp the layout, and
v1 wants a primitive that scaffolds — without committing to its
shape — the future mobile pass (deferred per
[`docs/ui/README.md → Mobile variants`](../ui/README.md#cross-cutting-states-not-standalone-screens)).

## Scope

- **Reader / composer's right-side Browse rail only.** Not
  generalized to other surfaces (World list pane, Plot, Chapter
  Timeline) in this pass. If those grow analogous needs, that's a
  separate design — likely cross-cutting at `principles.md`
  level, not a rail-by-rail repeat.
- **Mobile is parked.** The collapsed-state primitive is
  intentionally simple enough not to paint mobile into a corner;
  mobile may take a different shape entirely.

## Decisions

### 1. Collapsed state — full-height edge strip

When collapsed, the rail squeezes to a full-height vertical strip
on the screen's right edge (~16–24px wide, exact value tunable in
the visual identity pass). The strip:

- Provides a **visual silhouette** so the rail is discoverable —
  a continuous vertical region telegraphs "the rail lives here,"
  matching the spatial home for OS sidebar conventions.
- Acts as the **expand affordance**: clicking anywhere on the
  strip restores the rail.
- Has **no functional content**. No indicators, no kind icons,
  no awareness signals. Pure click target + silhouette.

The strip sits at muted opacity (similar to the rail's
border-left treatment) and brightens slightly on hover to confirm
clickability.

#### Why no top-bar slot

A top-bar toggle was considered (e.g.,
`[status][br][⎇][⛭][rail][←]`) and rejected. Two project
invariants pulled against it:

- **Back is rightmost everywhere.** That's a load-bearing global
  rule for muscle memory. Penultimate-back on this one screen
  costs more than it saves.
- **Spatial gravity.** A right-side rail's toggle belongs at the
  right edge, not in the chrome cluster. The strip places the
  affordance where the rail itself lives.

#### Why no per-rail awareness indicators

The strip's silhouette tempted a "what's new on the rail since
you last looked" indicator surface — a dot, a count, or a
recently-classified accent projected from the rail rows
([entity row indicators pattern](../ui/patterns/entity.md#entity-row-indicators--four-orthogonal-channels)).
That's deliberately deferred. No project-wide pattern exists for
classification awareness — what changed, across which surfaces,
at what granularity — and inventing one mid-side-rail-design
mixes scopes. See
[Followups generated](#followups-generated) below.

### 2. Open-state collapse trigger — chevron in rail header

When the rail is open, a small chevron in the rail header's
top-right corner (`›`) collapses it. Pointing toward the right
edge to telegraph the motion. Tooltip: `Collapse rail` or
similar wording finalized at visual identity.

Keyboard shortcut: `Cmd/Ctrl+\`. Mirrors VSCode's sidebar
toggle. Toggles regardless of focus location.

### 3. State model — manual + viewport, decoupled

Two state inputs combine to determine display:

- **Manual preference** — set by user clicking the chevron, the
  strip, or pressing the keyboard shortcut. Persists.
- **Viewport-forced collapse** — fired by viewport resize events
  crossing a width threshold. Overrides display without
  overwriting manual preference.

Pseudo-rule:

```
on user toggle (chevron / strip / shortcut):
  manual_preference = (toggle); apply immediately

on resize event crossing threshold downward (viewport < ~900px):
  display = collapsed (manual_preference unchanged)

on resize event crossing threshold upward (viewport > ~980px,
~80px hysteresis):
  display = manual_preference (restore)
```

Crucially, viewport check is **event-driven** (one-shot on
threshold cross), not a continuous constraint. Otherwise:
clicking the strip in a small window would do nothing — the
viewport rule would immediately re-collapse the rail. Decoupling
manual from viewport lets a user explicitly expand the rail in a
cramped window, accept the squeeze, and have the rail stay open.

Threshold pixel values (~900 / ~980) are tunable in the visual
identity pass; this design locks the **rule shape** (event-
driven, hysteresis, manual preference preserved underneath), not
the specific breakpoints.

### 4. Persistence — global, across launches

Manual preference persists app-globally across launches. Not
per-story, not per-session. Storage venue is an implementation
detail (a small UI-state surface — localStorage or a
`ui_state` key — not a `stories.settings` field; this is
ergonomic chrome state, not story content).

First-launch default: **open**. New users discover the chevron
and strip-collapse organically before adopting them; defaulting
to collapsed would hide the rail's functionality from first-time
users.

### 5. Peek drawer interaction — peek implies rail open

The peek drawer is invoked **only by clicking entity rows in the
expanded rail** (per
[reader-composer.md → Peek drawer](../ui/screens/reader-composer/reader-composer.md#peek-drawer--lead-affordance-for-characters)).
Prose entity references do not open peek; level-1 surfacing
(rail rows) is the only path.

Therefore peek and collapsed-rail are **mutually exclusive
states**:

- Open + click entity row → peek slides in over rail + narrative
  (status quo).
- Collapsed → no path to invoke peek without first expanding.

Collapsing the rail while peek is open closes the peek
simultaneously. They're a continuum: peek is a deeper state of
"rail engaged," collapse is "rail dismissed." Closing the
container closes its contents.

### 6. Animation — symmetric horizontal slide

~150ms ease-out for collapse, ease-in for expand. Symmetric. The
rail and the strip are visually a continuum — collapsed is "rail
squeezed to the strip," expanded is "rail at full width" — no
fade, no separate elements appearing. The narrative column's
right edge slides left/right in lockstep.

## Adversarial pass

### Load-bearing assumption

That users will discover the strip-as-expand-target. The
chevron-in-header is the discovery vehicle: a user collapses the
rail manually, learns the affordance round-trip in one
interaction, and the strip becomes recognizable on subsequent
collapses (manual or viewport-forced). The keyboard shortcut is
backup for users who never explore visually.

The risk: a user opens the app on a small window where the
viewport-forced collapse fires immediately, before they've
learned the affordance. They see a strip with no obvious
expand cue. Mitigations:

- Strip hover state (slight brighten) confirms clickability.
- Tooltip on hover (`Expand rail`) names the action.
- First-launch default is `open`, which the user has to
  manually collapse before viewport-forced collapse can surprise
  them — for users on viewports above the threshold.

### Edge cases

- **User clicks strip while viewport < threshold.** Manual
  preference becomes `open`, display = open. Window stays small.
  Rail competes with prose. User accepts the squeeze; subsequent
  resize events recompute. Acceptable.
- **User collapses rail with peek open.** Peek closes
  simultaneously (decision §5). No orphan peek drawer hovering
  over a collapsed rail.
- **Resize storms (rapid drag from large to small to large).**
  Hysteresis (~80px) absorbs jitter. State changes only when
  threshold + hysteresis is genuinely crossed.
- **Strip width vs touch targets.** 16–24px is below the ≥44px
  touch-target conventional minimum. Mobile is parked (per
  Scope), so this is acceptable for v1; mobile pass owns its own
  shape.
- **Resize crossing threshold while peek is open.** Same as
  manual collapse — rail collapses, peek closes. The viewport
  trigger and the manual trigger collapse the rail by the same
  mechanism.

### Read-site impact

- Where rail-state is read: only the reader / composer's layout
  CSS / state-flag.
- Browse rail content (filter chips, search, entity rows) is
  unchanged by this design — they live inside the rail
  regardless of its open / collapsed state.
- The icon-actions pattern is unchanged; per-row icons remain
  inside the rail rows.
- No data model changes. No `stories.settings` or
  `app_settings` schema changes — UI ergonomic state lives
  outside story / app domain data.

### Doc-integration cascades

- Adds a new section to
  [`reader-composer.md`](../ui/screens/reader-composer/reader-composer.md)
  for collapse / expand. New heading anchor (`browse-rail--collapse-expand`
  or similar).
- Wireframe (`reader-composer.html`) needs:
  - Open-state chevron in rail header (top-right corner).
  - Collapsed-state strip variant.
  - Toggle in the review-controls bar so reviewers can flip
    between open / collapsed.
- No `principles.md` change — the design is reader-specific. If
  the pattern generalizes to World / Plot / Chapter Timeline
  later, that pass owns the principle.
- No pattern change. Strip is not a pattern (yet); it's a single-
  surface chrome decision.

### Missing perspective

- **Implementation cost.** Small. CSS grid template change +
  state flag. Resize listener with threshold logic. Persistence
  via existing UI-state surface. Not blocking.
- **Cross-platform.** Electron + RN Web cover. Mobile parked.
- **Translation.** Rail's UI chrome (filter chips, search) is
  not user-content; rail-state has no translation bearing.
- **Undo / rollback.** Rail-state is ergonomic UI, not delta-
  logged story state. Out of rollback scope.
- **Settings UI.** No App Settings exposure needed. The toggle
  is the UI itself — like scroll position, no setting required.

## Followups generated

- **Classification awareness pattern (UX).** What does "what
  changed since I last looked" mean across surfaces? Per-kind?
  Per-event? What vocabulary, what visual treatment?
  Cross-cutting concern surfaced when designing the strip —
  parked here so it gets the design attention it deserves rather
  than being half-invented as a side-rail subsidiary feature.
  Lands when classification awareness becomes the focus of its
  own design pass.

## Doc integration

- **`reader-composer.md`** — new section under
  [Layout](../ui/screens/reader-composer/reader-composer.md#layout)
  or near
  [Browse rail — search scope](../ui/screens/reader-composer/reader-composer.md#browse-rail--search-scope).
  Covers the collapsed-state strip, the open-state collapse
  chevron + keyboard shortcut, the state model summary, peek-
  drawer interaction, and animation.
- **`reader-composer.html`** — wireframe updates:
  - Add `›` collapse chevron to the rail header (top-right
    corner of `Browse` section-head).
  - Add a collapsed-state mock with the full-height edge strip.
  - Add a review-controls toggle: `rail: open | collapsed`.
  - Animate the transition (CSS transform / grid-template
    change) so reviewers can see the slide.
- **`followups.md`** — add the **Classification awareness
  pattern** entry under `## UX`.
- **`user-notes.local.md`** — remove the `Side rail collapse /
expand` line (resolved by this integration).
