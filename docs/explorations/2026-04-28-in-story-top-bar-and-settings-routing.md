# In-story top-bar shape + settings routing amendment

Resolves the open followup "Top-bar shape on World and Plot
panels" (now removed from `followups.md`) and tightens two adjacent
concerns surfaced during the discussion: the visual polysemy of the
gear icon (App Settings vs Story Settings), and the contextual
Return target when Story Settings is reached from outside an active
story.

The reader stays full-fidelity; in-story sub-screens take a
narrower, consistent shape; settings routing is disambiguated by
making the icons themselves carry their scope. Stack-aware Return
becomes a global principle so each screen doesn't restate it.

## Background

Today's chrome on in-story screens is inconsistent.

- **Reader / composer** carries full chrome: status pill, chapter
  chip ▾, progress strip, time chip, branch chip (when > 1),
  Actions, ⚙, ←.
- **World** and **Plot** carry a partially-simplified shape:
  `<title> · Chapter N · region` label + branch icon (count badge) +
  Actions + ⚙ + ←. The chapter context label sits in the top bar
  alongside a separate sub-header breadcrumb (`World / Characters /
Kael`) — two lines of crumb-style content.
- **Story Settings** and **Chapter Timeline** carry the minimal
  shape: logo + breadcrumb + Actions + ←. The ⚙ is absent on Story
  Settings (self-references) and on Chapter Timeline (rationale at
  the time: sibling screen reachable via Actions menu).

The gear icon ⚙ has overloaded meaning: it opens App Settings on
story-list and Vault, and Story Settings on reader / World / Plot.
Same glyph, different destinations, no visual signal which.

Story Settings has two entry points — from inside the story (gear
in chrome) and from the story-list card (`⋯ → Edit info`) — without
a spec'd answer for what that second path does to chrome and
navigation.

## Decisions

### 1. Three-tier top-bar chrome on in-story screens

The reader-vs-sub-screen split becomes structural. Three tiers of
chrome:

**Universal essentials** — every in-story screen carries these:

- Logo
- Breadcrumb (screen-level path; see [master-detail sub-header rule](#master-detail-sub-header-rule)
  below for the in-pane navigation case)
- Actions menu
- Settings icon (scope-determined — see [decision 2](#2-settings-icon-scope-rule))
- ← Return (stack-aware — see [decision 4](#4-stack-aware-return-as-a-global-principle))

The ⚙ / Settings icon is absent only on Story Settings itself
(self-reference) and on the story root (story-list, where ⚙ does
exist but means App Settings — outside this rule's scope).

#### Master-detail sub-header rule

**Master-detail surfaces with a kind selector + list pane** (World,
Plot) render an in-pane breadcrumb sub-header below the top bar
(`Characters / Kael`, `Threads / Crown's bargain`). The top-bar
breadcrumb is screen-level (`<story-title> / World`) and stays
stable as the user navigates list rows; the sub-header is reactive
content that updates with the in-pane selection.

**Single-content surfaces and master-detail surfaces with a
category rail** (Story Settings, Chapter Timeline) put the full
breadcrumb inline in the top bar — no sub-header. Their inner
navigation is captured by the rail or the list itself.

The asymmetry tracks the master-detail pattern, not arbitrary
chrome variation.

**Universal in-story chrome** — renders on every in-story screen
regardless of which surface:

- **Status pill** (gen-state indicator). Auto-hides when idle, shows
  during pipeline phases. Same click-to-cancel popover behavior as
  the reader. Pipeline state is global to the active story; users
  navigating to World, Plot, Story Settings, or Chapter Timeline
  during generation deserve the same affordance.
- **Progress strip** (chapter token usage). Small visual cost; tells
  power users how close they are to chapter close regardless of
  which surface they're on. Doesn't carry a textual label, doesn't
  collide with the breadcrumb. Useful for awareness; ignorable when
  irrelevant.

**Reader-only chrome** — only renders on reader / composer:

- Chapter chip ▾ (chapter popover with jump + manage)
- Time chip (in-world date-time display)
- Branch chip (icon + count badge, when > 1 branch)

These are pulled from sub-screens for two reasons. Chapter and time
are textual indicators that overlap semantically with the breadcrumb
on every sub-screen — the breadcrumb already names where the user
is in the story. Branch navigation is a reader-level concern; sub-
screens don't switch branches as a primary action.

### 2. Settings icon scope rule

The gear glyph's polysemy is resolved by pairing each icon with the
scope it serves:

- **Regular gear ⚙** — opens App Settings. Renders only on app-
  level surfaces (story-list, Vault). Absent from in-story chrome.
- **Dedicated story-scoped icon** (specific glyph TBD at visual
  identity — book-cog, scroll-cog, sliders-with-bookmark, or similar)
  — opens Story Settings. Renders only on in-story surfaces (reader,
  World, Plot, Chapter Timeline). Absent on Story Settings itself.

App Settings remains reachable from in-story screens via the
**Actions menu** rather than chrome. App Settings is set-and-forget
territory; the two-click route is acceptable.

**Constraint for visual identity.** The two icons must be
visually distinguishable at glance. Both being "geary" defeats the
rule's purpose; the visual identity pass picks glyphs that read
clearly different.

### 3. Story Settings entry — load and route

`Edit info` from a story-list card boots the story (cheap — SQLite
reads, no pipeline) and routes directly to Story Settings. The
loaded story renders the canonical Story Settings with universal
in-story chrome (status pill hidden because idle, progress strip
reflecting current state).

This avoids a second render mode for Story Settings. The "load to
edit metadata" cost is acceptable: opening a story does not start
generation; the chrome elements are quiet by default.

The contextual Return target is handled by [stack-aware Return](#4-stack-aware-return-as-a-global-principle).
First Return after `Edit info` goes to story-list. Navigation
_beyond_ Story Settings (forward into the reader) consumes the one-
shot and reverts to the in-story default.

Existing guards cover the dirty/in-flight switch path:

- **In-flight pipeline on a different active story** — abort-confirm
  modal already gates leaving (per the
  [edit-restrictions principle](../ui/principles.md#edit-restrictions-during-in-flight-generation)).
- **Dirty save-session on a different active story** — navigate-
  away guard fires (per
  [save sessions](../ui/patterns/save-sessions.md)).
- **Idle, clean state** — silent switch.

No new edge cases introduced by Option A.

### 4. Stack-aware Return as a global principle

Header back-button (←) and system-level back actions are
**stack-aware**: they pop the in-session navigation stack rather
than always routing to a fixed parent.

- Stack scope: **in-session only**, reset on app restart. No
  cross-launch persistence.
- Pop semantics: Return = pop one level. The previous screen is
  whatever the user came from, even if that's a sibling rather than
  a hierarchical parent.
- Special-case: `Edit info` from story-list registers a one-shot
  return target = story-list. First Return consumes it; subsequent
  Returns follow stack default.
- **Empty stack (root state)**: a Return action at an empty stack —
  e.g., the very first screen of a fresh session, or after a deep-
  link that bypassed normal entry — has no previous page. The action
  is interpreted as "exit the app" and surfaces a confirm dialog
  before terminating. This matters most on mobile, where the system
  back button / swipe-back gesture is the primary exit pathway and
  unconfirmed exits drop user state silently. Desktop's window-close
  affordance is a separate exit pathway and follows OS-native
  patterns; this rule covers in-app back actions.

This codifies what was already the practical behavior (the Vault
calendar editor doc notes "back arrow returns to wherever you came
from") as an explicit principle, and applies it uniformly.

### 5. Screen scope

The amendment applies to:

- **Reader / composer** — full chrome (unchanged).
- **World** — drops chapter context label + branch icon; adds
  status pill + progress strip; gear glyph swapped for the dedicated
  story-scoped icon.
- **Plot** — same as World.
- **Story Settings** — adds status pill + progress strip; gear was
  already absent and remains so.
- **Chapter Timeline** — adds the dedicated story-scoped Settings
  icon (was absent), status pill, and progress strip.
- **App Settings, Story List, Vault** — keep ⚙ → App Settings; no
  chrome changes from this amendment. Vault parent shell is still a
  separate future pass, and inherits the resolved icon rule when it
  lands.

**Out of scope:**

- Mobile chrome adaptations. Mobile pass is deferred per
  [`ui/README.md`](../ui/README.md); the new principle is desktop-
  first and the mobile pass owns the adaptation.
- Visual identity (the actual glyph picks for both Settings icons,
  the progress strip's appearance, etc.). Visual identity pass owns.

## Adversarial check

Things considered, with verdicts:

- **Status pill clutter on idle sub-screens.** Pill auto-hides when
  idle (codified in principles.md → "hides when idle, shows during
  active pipeline phases"). Sub-screens don't grow a permanent
  visual element — verified, not assumed.
- **Progress strip during chapter-close.** Strip reads near 100%
  while the close is running; gives no extra info but doesn't lie.
  The existing chapter-close banner is the primary affordance during
  close. Not a regression — verified.
- **Visual identity collision.** Visual identity could later pick
  the same glyph for the story-scoped Settings icon and ⚙. Mitigated
  by codifying scope-distinguishability as an explicit constraint
  the pass must satisfy — not blocking, but flagged.
- **Stack-aware Return scope creep.** Persisting nav history across
  app restarts opens implementation complexity and weird "Return on
  first launch goes where?" cases. Mitigation: in-session-only is
  written into the principle.
- **Anchor breakage.** Renaming the principles heading invalidates
  9 inbound references. Update all in the same integration commit.
  Pre-commit (remark-validate-links) will catch any miss.
- **Story-list-to-Story-Settings load latency.** Cold story open
  reads SQLite rows; for very large stories this is non-trivial.
  Not a regression vs. opening the story normally; flagged as
  general perf territory, no decision needed here.
- **What if a user goes story-list → Edit info → Story Settings →
  reader → Return?** Stack pop semantics: Return pops Story Settings
  (the immediate parent on the stack). Stack at that point is
  `[story-list, Story Settings, reader]` → Return goes to Story
  Settings. Then Return again pops to story-list. Consistent with
  pop semantics; no special case needed.
- **Mobile.** Explicitly out of scope; mobile pass owns the
  adaptation. No assumption that desktop chrome translates 1:1.

Nothing load-bearing slipped. Verified vs. assumed:

- **Verified**: status pill auto-hide behavior, anchor inbound
  count, current chrome state on each affected screen, save-session
  navigate-away guard, abort-confirm modal coverage of in-flight
  story-switch.
- **Assumed but low risk**: visual identity picks distinguishable
  glyphs (mitigated by explicit constraint); load latency for cold
  story open is acceptable for the metadata-edit path (general perf
  territory, not unique here).

## Integration plan

One focused commit. Files affected:

**`docs/ui/principles.md`**

- Rename `## Top-bar design rule — essentials vs discretionary` to
  `## Top-bar design rule`. Restructure body into the three-tier
  chrome (universal essentials / universal in-story / reader-only)
  plus the screen-class scope (in-story vs app-level).
- Update the internal back-link in the "Status pill (chrome —
  universal)" sub-section under "Edit restrictions during in-flight
  generation" to the new anchor.
- Update `## Settings architecture — split by location` →
  "Entry points" sub-section: replace "Story Settings: reached from
  the gear icon in the reader top bar" with the new rule (gear ⚙ on
  app-level surfaces opens App Settings; story-scoped icon on in-
  story surfaces opens Story Settings; App Settings on in-story
  routes via Actions menu; story-list `⋯ → Edit info` is an
  alternative Story Settings entry that loads the story).
- Add `## Stack-aware Return` as a new top-level principle near the
  Top-bar rule. Covers the global behavior plus the `Edit info` one-
  shot.
- Visual identity constraint added inline under the Settings icon
  scope rule (icons must be glance-distinguishable).

**`docs/ui/screens/world/world.md` and `world.html`**

- Drop chapter context label and branch icon from top-bar.
- Add status pill and progress strip to top-bar.
- Swap ⚙ glyph (placeholder) for the dedicated story-scoped icon
  placeholder. Tooltip: "Story settings".
- Update the Top-bar prose section to point at the revised rule.
- Update the Layout ASCII to reflect the new top-bar.

**`docs/ui/screens/plot/plot.md` and `plot.html`**

- Same edits as World, plus: update the "Top-bar" prose section
  ("Same chrome as World panel — logo + story title + chapter chip
  - Actions + ⚙ + ←") to drop chapter chip mention and reflect the
    new shape.

**`docs/ui/screens/story-settings/story-settings.md` and `story-settings.html`**

- Add status pill and progress strip to top-bar.
- Update the Top-bar prose section to note: gear glyph absent
  (self-reference), but pill + progress strip render. Mention
  contextual Return target for `Edit info` entry.

**`docs/ui/screens/chapter-timeline/chapter-timeline.md` and `chapter-timeline.html`**

- Add the dedicated story-scoped Settings icon (was absent), status
  pill, and progress strip to top-bar.
- Update the Top-bar prose section to drop the "gear absent because
  sibling screen, route via Actions" rationale; replace with the
  three-tier rule reference.
- Remove the cross-reference at the bottom (`See followups → Top-
bar shape on World and Plot for the parallel question on those
panels.`) — followup resolved.

**`docs/ui/screens/reader-composer/reader-composer.md` and `reader-composer.html`**

- Swap ⚙ glyph (placeholder) for the dedicated story-scoped icon
  placeholder. Tooltip remains "Story settings".
- No other top-bar changes — reader retains full fidelity.
- Update inbound anchor reference to the renamed principle.

**`docs/ui/screens/reader-composer/branch-navigator/branch-navigator.md`**

- Update three inbound anchor references to the renamed principle.

**`docs/ui/screens/story-list/story-list.md`**

- Update inbound anchor reference to the renamed principle.
- Add a brief note that `⋯ → Edit info` boots the target story and
  routes to its Story Settings (Return is stack-aware, first Return
  goes back to story-list).

**`docs/ui/patterns/icon-actions.md`**

- Update inbound anchor reference to the renamed principle.

**`docs/ui/screens/vault/calendars/calendars.md`**

- Update inbound anchor reference to the renamed principle.

**`docs/explorations/2026-04-27-edit-restrictions-during-generation.md`**

- Update inbound anchor reference to the renamed principle. (Past
  exploration; pre-commit validates anchors regardless of dir.)

**`docs/followups.md`**

- Remove the "Top-bar shape on World and Plot panels" entry under
  the UX section (resolved).

**No new followups generated.**

Mobile chrome and visual identity glyph picks are pre-existing
deferred sessions; the amendment respects their scope without
adding new entries.

## Disposition of this exploration

Per project convention, exploration docs are kept as a record or
removed once integrated — user's call. Default: keep, since this
amendment touches multiple canonical sections and the doc is the
narrative for the change.
