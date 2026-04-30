# Reader scroll polish — windowing, autoscroll, jump buttons

Specs three reader / composer scroll behaviors that need polish:
rendering at scale, autoscroll engage / disengage / re-engage, and
jump-to-top / jump-to-bottom affordances. Resolves the
"Scrolling in the story" / "autoscroll" / "jump buttons" cluster
from `user-notes.local.md`.

## Background

The reader / composer renders an unbounded log of entries within a
single branch. Three concrete polish items surfaced:

- **Scrolling at scale.** Plain DOM rendering breaks once a branch
  has ~1000+ entries. The existing
  [`patterns/lists.md`](../ui/patterns/lists.md) splits long lists
  into virtual-list (bounded catalogs) vs. load-older (log-shaped
  unbounded) — both single-window models. Reader narrative is
  log-shaped, but at scale the window itself becomes DOM-heavy:
  virtualization has to compose with the loading strategy.
- **Autoscroll.** When the user is at the bottom and an AI reply
  starts streaming, the viewport should follow tokens. When the
  user scrolls up to read older context mid-stream, autoscroll
  must release them. Coming back, it should resume — manual
  re-engagement is too high-friction for a behavior that should
  feel automatic.
- **Jump buttons.** Returning to the live edge after scrolling
  away is a one-click action in every chat app. Jumping to the
  start of the branch is a less-universally-wanted affordance,
  but real users have asked for it.

## Scope

- **Reader / composer entry list only.** Not generalized to other
  log-shaped surfaces (per-entity History, Plot panel History,
  future global delta-log). Those use plain `Load older` today
  with explicit-click semantics; reader's auto-load variant is a
  single-surface deviation, not a promoted pattern.
- **Mobile is parked** alongside everything else mobile-shaped
  (per [`docs/ui/README.md`](../ui/README.md#cross-cutting-states-not-standalone-screens)).
  The button placement and gesture model don't paint mobile into
  a corner.
- **Library choice for virtualization stays parked** in
  [`followups.md → Virtual-list library choice`](../followups.md#virtual-list-library-choice).
  This design adds the reader narrative as another use case and
  flags variable-height + scroll-anchoring as new constraints,
  but doesn't pick a library.

## Decisions

### 1. Loaded-set model — single window, swap on jump, auto-load on boundary

The reader's narrative is log-shaped and unbounded; the read
pattern is "recent-most-first" (you open the reader to see the
latest). At any moment the loaded set is a **single contiguous
window** of entries — never two disconnected windows, never
partial-and-stitched. Three primitives compose:

#### Window

The contiguous range of entries currently in memory + DOM. Always
one. On branch open: ~50 most recent entries. Grows as the user
approaches a boundary (auto-load); swaps wholesale when the user
jumps to a non-adjacent region.

#### Auto-load on scroll boundary

As the user scrolls within a window:

- **Approaching the top of the loaded range** (within ~one
  viewport-height of the topmost loaded entry) → auto-fetch the
  next older chunk (~50 entries). Content prepends; native
  browser scroll-anchoring keeps the user's visible content
  stable.
- **Approaching the bottom of the loaded range** (within ~one
  viewport-height of the bottommost loaded entry, when that
  isn't the live edge) → auto-fetch the next forward chunk.
  Content appends.

Loading shimmer at the boundary edge during fetch — so fast
scrollers don't hit empty space. This is the reader's deviation
from `lists.md`'s explicit-click `Load older` rule; the
existing rule applies to History-tab-shaped surfaces where
auto-loading older content while glancing at recent state is a
surprise. For the reader, the auto-load fires only on **boundary
approach**, which is the user explicitly asking for more in that
direction — no surprise.

#### Swap on jump

When the user invokes [jump-to-top or jump-to-bottom](#3-jump-buttons)
to a region not adjacent to the current window, the entire window
swaps:

- **Jump-to-top** → unload current window, fetch entries 1..50 of
  the branch, render. Instant cut to entry 1 in viewport.
- **Jump-to-bottom from non-recent window** → unload current
  window, fetch entries `last-49..last`, render. Instant cut to
  bottom.
- **Jump-to-bottom while already in the recent window** → smooth
  scroll (~150ms) to bottom. No swap; the recent window is
  already loaded.

#### Scroll-position restoration per window

Each branch has up to two **remembered scroll positions** — one
for the recent window, one for the top window (if either has been
visited this session). When the user swaps windows:

- Save the current window's scrollTop before unloading.
- After loading the destination window, restore its previously
  saved scrollTop if any (else: top window starts at top, recent
  window starts at bottom).

So: user at entry 4978 (mid-recent) jumps to top → reads start →
jumps to bottom → lands back at entry 4978, not at 5000. Standard
tab-state pattern; required for the swap model to feel sane.

Positions reset on branch switch.

#### Virtualization within the window

Inside the window, only visible rows + small overscan render to
DOM. Library choice stays parked; reader narrative is now a use
case that informs the decision (variable-height entries with
reasoning-body height toggles push toward measured-row strategy,
not fixed-height).

### 2. Autoscroll — auto-re-engage on return to bottom

Per-stream state machine: **engaged** ↔ **disengaged**, with
auto-re-engagement on return to bottom.

**Engage condition (per stream).** When an AI reply begins
streaming, autoscroll evaluates: is the viewport at-bottom (within
~80px tolerance)?

- At bottom → engaged. Viewport pins to streaming entry's bottom
  edge as tokens arrive.
- Not at bottom → disengaged. Streaming entry grows below the
  fold; user keeps their position.

The ~80px tolerance is generous because the suggestion-panel +
composer chrome sits below the entries; users near-bottom but not
pixel-pinned should count.

**Disengage.** Any user-initiated scroll upward during a stream
→ disengaged for the rest of the stream. Detection: track
`scrollTop` set by autoscroll programmatically; if a scroll event
reports a different `scrollTop`, it's user-initiated.

**Re-engage (auto).** User scrolls back to within ~80px of bottom
while still in the same stream → autoscroll re-engages. Viewport
pins back to streaming entry's bottom.

**Stream end.** Engaged / disengaged state resets. Next stream
re-evaluates fresh.

#### Why auto over manual

Manual re-engagement (button-only) is more explicit and avoids
edge cases where a height shift drifts the user back into the
at-bottom threshold. But it has discoverability cost: users who
don't notice a button get stuck off-rails. For a behavior that
should feel automatic ("the screen follows the reply"), the user
shouldn't have to learn a button. Accept the edge-case complexity
in exchange.

#### Edge: layout shifts

- **Reasoning body expansion on an earlier entry.** Document
  grows above viewport; native browser scroll-anchoring keeps
  visible content stable (`scrollTop` adjusts in lockstep with
  new content height). Implementation note: the chosen
  virtualization library MUST preserve scroll-anchoring on
  above-viewport mutations — verify at library-pick time.
- **Suggestion panel appearing at stream end.** Adds ~80px to
  document height between last entry and composer. If user was
  engaged, they're at-bottom; the panel pushes content down but
  viewport stays at the new bottom (engagement carries through
  the layout shift). If user was disengaged + above tolerance,
  the panel doesn't move them.

#### Streaming while in a non-recent window

If the user has jumped to top (current window = entries 1..50) and
the AI is streaming a reply, the streaming entry is at the live
edge — outside the loaded window. The pipeline still writes to
the store; the rendering layer simply doesn't show the streaming
entry until the user returns to the recent window. The chrome
status pill (per
[`principles.md → Universal in-story chrome`](../ui/principles.md#universal-in-story-chrome))
remains the cross-window awareness signal that something is in
flight. When the user jumps back to bottom, the (possibly
complete) entry is in the recent window when reloaded.

#### Edit-restrictions interaction

Scroll is a **read** action. Per
[`principles.md → What's not gated`](../ui/principles.md#whats-not-gated),
reads of the live store during pipeline writes are accepted.
Autoscroll, jump buttons, and auto-load fetches are all
unaffected by the in-flight transaction gate.

### 3. Jump buttons

Two floating affordances in the scroll viewport, stacked
vertically near the right edge, above the suggestion panel +
composer chrome.

#### Visibility (conditional)

- **Jump-to-bottom** — visible when the user is NOT at-bottom of
  the recent window, OR when the current window is not the recent
  window. Slides in / out on threshold cross.
- **Jump-to-top** — visible when (a) the
  [App Settings toggle](#4-toggle-in-app-settings) is on AND (b)
  the current window is not the top window OR the user is not
  scrolled to entry 1 within it. Hidden otherwise.

#### Click behavior

- **Jump-to-bottom.** If currently in the recent window: smooth
  scroll (~150ms) to bottom. If currently in the top window
  (post-jump): swap (unload top, load recent), instant-cut to
  bottom of recent. Re-engages autoscroll if a stream is in
  flight and the user lands at-bottom.
- **Jump-to-top.** If currently in the top window (already loaded):
  smooth scroll to entry 1. If currently in the recent window:
  swap (unload recent, load entries 1..50), instant-cut to entry
  1.

The swap path is always instant cut — there's no in-between
content to traverse smoothly. The same-window path is smooth
scroll because there is.

#### Keyboard shortcuts (always available, regardless of toggle)

- `Home` — jump-to-top
- `End` — jump-to-bottom

#### Actions menu entries (always available)

- `Jump to top of branch`
- `Jump to bottom`

The toggle gates only the visible scroll-chrome button. Keyboard
and Actions remain on regardless. The toggle is "show this button
or not" — never "disable this feature."

#### "Top of branch" semantics

"Branch top" means the first entry of the **current branch** —
i.e., the first entry post-fork on a non-root branch, or entry #1
of the root branch. The reader does not walk fork chains across
branches. Users who want to read pre-fork content (the parent
branch's history before this branch diverged) switch to the
parent via the
[Branch navigator](../ui/screens/reader-composer/branch-navigator/branch-navigator.md).
Jump-to-top respects branch boundaries; cross-branch navigation
is a separate concern.

#### Chapter-top is not a separate button

The chapter chip in the top-bar already opens a popover with
chapter rows. "Jump to chapter start" is a per-row affordance
inside that popover — leverages existing chapter chrome rather
than adding a third scroll button. Scroll-chrome buttons stay
focused on terminal endpoints (top / bottom of branch);
chapter-anchored navigation lives with chapter chrome.

#### Branch switch

Switching branches resets reader scroll state: window resets to
the recent ~50 entries of the new branch, scrolled to bottom.
Saved scroll positions for the previous branch are dropped.

### 4. Toggle in App Settings

New entry under `APP · Appearance`:

- **Label:** `Show jump-to-top button` (refine in copy pass)
- **Default:** OFF — matches "not every user needs it" framing.
- **Storage:** app-level UI preference; not copied per-story.

The toggle is pure UI chrome preference, app-wide. No per-story
override. Existing per-story toggles (`composerModesEnabled`,
`suggestionsEnabled`) are narrative-shaping; this is navigation
chrome — different shape, different scope.

### 5. Pattern cascade — minimal `lists.md` extension

The reader's loaded-set model is reader-specific:

- Single window with swap-on-jump + auto-load-on-boundary
  describes a single surface's behavior. Other log-shaped surfaces
  in the project (History tabs, delta logs) read backward only;
  they don't have a "jump to oldest" use case and the surprise
  argument for explicit-click `Load older` still applies. Promote
  to a pattern only if a second surface adopts it.
- Virtualization composing with the loading strategy at scale
  applies generally — `lists.md`'s existing patterns (virtual list,
  load-older) both compose with virtualization for DOM weight when
  the loaded set itself becomes heavy.

So `lists.md` gets a small note in `### Threshold` (or a sibling
sub-section) clarifying that virtualization composes with both
patterns above it for DOM weight at scale. The reader narrative
is cited as a v1 use case. The full reader-specific behavior
(swap, auto-load, autoscroll, jump buttons) lives in
[`reader-composer.md`](../ui/screens/reader-composer/reader-composer.md).

## Adversarial findings

- **Scroll-anchoring is load-bearing.** The design relies on
  native browser scroll-anchoring keeping visible content stable
  when content is inserted above the viewport (auto-load older
  chunk; reasoning expansion on an earlier entry). True for
  native scroll containers; some virtualization libraries break
  this because they manipulate `scrollTop` programmatically.
  Library choice MUST verify scroll-anchoring is preserved.
  Captured as an implementation note above; flagged for the
  [Virtual-list library choice followup](../followups.md#virtual-list-library-choice).
- **Auto-load distance tuning.** "~one viewport-height" is a
  starting heuristic for the trigger threshold. Too early =
  wasted fetches if user reverses; too late = visible
  empty-loading at the boundary. Tunable in implementation; the
  shape (boundary-approach trigger, loading shimmer at edge) is
  what's locked here.
- **Scroll-position restoration is required, not optional.**
  Without it, the swap model loses the user's place every time
  they peek at the start. Implementation must save scrollTop on
  swap and restore on return — design surface, not
  implementation detail.
- **Empty branch.** A fresh branch with no entries: jump buttons
  hidden (no top to jump to, no bottom to be away from);
  autoscroll degenerate. Empty-state pattern owns the surface.
  No conflicts.
- **First-turn streaming.** Branch with one entry plus an
  in-flight stream: at-bottom check trivially true; autoscroll
  engages; standard flow.
- **Stream completes while user is in top window.** Pipeline
  writes happen in the data layer regardless of which window is
  rendered. Suggestion panel appears in the (currently unloaded)
  recent window — invisible to the user until they jump back.
  Status pill in chrome remains the awareness signal. Click
  jump-to-bottom → swap to recent, see the new entry + suggestion
  panel.
- **Cross-branch confusion.** "Top of branch" stops at the
  current branch's first entry, not entry #1 of the root branch.
  Users on a deep fork who expect "top" to walk fork chains will
  be surprised. Documented explicitly; the Branch navigator is
  the cross-branch surface.
- **User-vs-programmatic scroll detection.** The standard
  implementation pitfall — autoscroll's own programmatic
  `scrollTop` writes can fire `scroll` events that look like user
  scrolls and trigger spurious disengagement. Detection strategy
  is in the autoscroll section above. Implementation concern, not
  a design flaw.
- **Streaming target is in unloaded window: render-rejoin
  semantics.** When the user jumps back to the recent window mid-
  stream, the streaming entry's content has been accumulating in
  the store the whole time. The render reattaches to the in-
  progress stream — token append continues into the now-mounted
  entry. Standard subscriber-late-attaches-to-store pattern; the
  store is the source of truth, not the DOM.

## Open questions / followups

None blocking the integration. Implementation-time concerns:

- **Library choice** — updates the existing
  [Virtual-list library choice followup](../followups.md#virtual-list-library-choice)
  with reader narrative as another use case (variable-height,
  scroll-anchoring requirements).
- **Tolerance + chunk + auto-load-distance tuning** —
  measurement-time decisions, not design.
