# Slice 2.4 — Story list as a real surface + stories store

## Metadata

- **Milestone:** [Milestone 2 — First user loop](../milestone.md)
- **Depends on:** none for the surface (StoryCard / Toolbar /
  ScreenShell are shipped; develops against seeded story rows);
  [Slice 2.5](./05-reader.md) for the debug-button removal task
  only.
- **Blocks:** [Slice 2.10](./10-recovery-ui.md) (the
  parse-failure badge renders on this surface)

## Goal

Replace the M1 empty landing with the real library: a **stories
store** (this slice owns it — C1 in
[the milestone doc](../milestone.md#c1--stories-store-api)),
real story cards, search / filter / sort, favorite + archive,
draft cards with the wizard-session prompts wired, navigation
into the reader, the AI-configuration banner host, and removal of
the M1 `__DEV__` "Open reader (debug)" button once the real
reader path exists.

## Background

Slice 1.7b shipped the landing as an empty shell whose only
reader path is a debug button. M1.5 typed the `stories` table but
the library working set has no store yet — stories are a config
table, not a delta-logged domain, so this store is hydrate +
selectors + plain column writes rather than a delta-mirrored
working set. StoryCard is already built with its visual contract
pinned; this slice feeds it real rows and wires its affordances.
Creation flows in from [Slice 2.3](./03-wizard.md) through the
pinned C1 refresh surface, so the two slices run in parallel.

## Required reading

- The whole surface, section by section:
  [Toolbar](../../../../ui/screens/story-list/story-list.md#toolbar),
  [Story card](../../../../ui/screens/story-list/story-list.md#story-card--text-first),
  [Drafts](../../../../ui/screens/story-list/story-list.md#drafts--wizard-session--explicit-draft),
  [Empty state](../../../../ui/screens/story-list/story-list.md#empty-state-first-launch),
  [Banner](../../../../ui/screens/story-list/story-list.md#banner--ai-configuration).
- [`data-model.md → Story identity fields`](../../../../data-model.md#story-identity-fields)
  — columns, the `favorite DESC` sort invariant, status
  lifecycle (drafts can't archive).
- [`ui/patterns/story-card.md → Compound API`](../../../../ui/patterns/story-card.md#compound-api)
  — the shipped compound's contract this slice binds.
- [`ui/patterns/banners.md → Variants`](../../../../ui/patterns/banners.md#variants)
  — AI-not-configured variant; CTA routes to the
  [Slice 2.1](./01-provider.md) interim form until M7.1.

## Scope: in

- **Stories store** (owner): hydrate at boot / landing from
  `stories`, selectors for the toolbar inputs (search over
  title / description / genre label / tags, the three filter
  chips, the three sort keys, favorite-first invariant), plain
  column writes for `favorite`, `status` (`active ↔ archived`),
  and `last_opened_at` touch on open. The C1 creation-refresh
  surface [Slice 2.3](./03-wizard.md) calls, and the per-story
  open-failure state slot [Slice 2.10](./10-recovery-ui.md)
  renders from.
- **List surface:** grid of StoryCards (genre overline,
  draft / archived badges, meta row, description fallback),
  toolbar, empty-state welcome with the scaled CTA, header
  `+ New story` routing into the wizard.
- **Draft handling:** draft cards (untitled placeholder, muted
  genre, `draft · 0 entries` meta), click re-opens the wizard
  pre-populated; both concurrent-state prompt triggers wired to
  the C5 prompt component from [Slice 2.3](./03-wizard.md).
- **Card overflow menu** with the M2-backed entries only:
  Archive / Unarchive and Edit-info-less minimum (see Scope:
  out); favorite is the inline star.
- **Navigation:** card click opens the reader route with
  `last_opened_at` touched.
- **Debug-button removal:** delete the 1.7b `__DEV__` "Open
  reader (debug)" landing button (only this button — the rest of
  the smoke teardown is [Slice 2.7](./07-wiring.md)). Ordered
  after 2.5 merges.

## Scope: out

- Story **Delete** on the card menu — milestone open question;
  default out (archive is the M2 cleanup affordance; cascade
  deletion has no spec section).
- **Duplicate** (M6.6), **Export** (M9.4),
  **`[Import story…]`** (M9.4), cover display (visual identity),
  **Edit info** routing into Story Settings · About (story
  settings real surface is M4.4).
- Branch count on cards / branch-aware URLs — M6.5.
- The per-story parse-failure badge UI — [Slice 2.10](./10-recovery-ui.md)
  (this slice only carries the state slot in the store).

## Acceptance criteria

- With seeded rows (drafts, archived, favorited, mixed
  last-opened), the list renders per spec: favorites float first
  within every filter; `All` hides archived; search hits all four
  scoped fields; the three sort keys order observably —
  `last-opened` by `last_opened_at` descending (default),
  `created` by `created_at` descending, `title` ascending — each
  beneath the `favorite DESC` layer.
- Favorite star and Archive toggle persist across an app restart
  (column writes, no deltas — asserted by test).
- Draft click with a live wizard session fires the
  concurrent-state prompt with the draft-variant copy; `+ New
story` with a session fires the new-story variant. Resolutions:
  `Continue` resumes the session in the wizard; the discard
  variants clear the session and open a fresh wizard or the
  picked draft respectively; dismissing changes nothing.
- Card click lands in the reader with the story open and
  `last_opened_at` updated; empty database renders the welcome
  state with toolbar and header CTA hidden.
- After this slice + 2.5, no `__DEV__` reader button remains on
  the landing.
- The AI-not-configured banner shows iff `providers` is empty and
  routes to the interim form.

## Tests

- Vitest: store hydrate + selector matrix (filter × sort ×
  favorite invariant), column-write round-trips, no-delta
  assertion on UI-field writes.
- Storybook: story-list states (populated / empty / drafts /
  banner) at the surface level if extracted as a compound;
  StoryCard stories already exist.
- Manual: phone-tier reflow per the doc's mobile expression —
  pass = header buttons wrap below the title, grid collapses to
  one column, no horizontal overflow, overflow menu opens as a
  bottom sheet.

## Open questions

- Whether story Delete gets pulled in (milestone open question —
  decide here at planning).

## Implementation notes

Resolved during planning + execution (full execution plan was the
git-ignored `.impl-plans/M02-04-story-list.md`).

- **Story Delete pulled in** (milestone open question → in). Implemented as
  a transactional full-graph cascade (`lib/actions/stories/delete-story.ts`):
  deletes the entire owned graph child→parent, **excludes** shared
  `vault_calendars` and content-addressed `assets` blobs (drops `entry_assets`
  junction rows only). Policy pinned in
  [`data-model.md → Story deletion`](../../../../data-model.md#story-deletion).
  A schema-derived completeness test fails if a branch-scoped table is added
  without wiring the cascade. The asset-trashing forward-coupling (M4/M9 GC
  must hook the story-delete path) is tracked in
  [`triage.md`](../../../triage.md).
- **Built against pinned contracts** (consumers unmerged). The C5 session
  selector + prompt are a local placeholder
  (`components/story/wizard-session-seam.tsx`) for
  [Slice 2.3](./03-wizard.md) to supersede; the banner CTA points at the
  interim `/settings` providers tab; the `/wizard` route is cast `as Href`
  until 2.3 lands it. The C1 creation-refresh surface 2.3 calls is
  `rehydrateStories(db)` (targeted re-read).
- **Persisted-mirror store.** Column writes (favorite / status /
  last_opened_at) and delete are action-layer writes that re-hydrate the store
  — the store exposes no value-setter. C1's "two externally-called mutators"
  resolve to `touchStoryOpened` (action layer) plus the in-memory open-failure
  `setOpenFailure` / `clearOpenFailure` (store).
- **StoryCard changes.** Out-of-scope menu callbacks (Edit info / Duplicate /
  Export) made optional and hidden when absent; all chrome converted to
  `t()`; Archive hidden on draft cards per the data-model archive-gating rule.
- **Added beyond the brief.** A no-results state on StoryList for when a
  filter / search matches nothing (distinct from the zero-stories welcome).
- **Debug-button removal deferred.** The M1 `__DEV__` reader button stays
  until [Slice 2.5](./05-reader.md) merges (execution-gated).
- **Handoffs.** [Slice 2.7](./07-wiring.md) extends `openStory` (strict
  definition / settings parse, `hydrate(branchId)`, open-failure write) and
  should give the currently-silent `{status:'no-branch'}` return a surface;
  [Slice 2.10](./10-recovery-ui.md) renders / clears open-failure via the
  store. Relative-time strings (`lib/stores/stories/relative-time.ts`) are not
  yet i18n'd — a cross-cutting pass with the sibling helper in
  `collision-resolve-dialog.tsx`.
