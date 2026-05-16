# User-action `worldTime` contract

**Date:** 2026-05-17
**Status:** Integrated — see `data-model.md`, `architecture.md`,
`entry-card.md`.

## Problem

The classifier doesn't run on `user_action` entries (see
[`architecture.md → Classifier contract — metadata fields`](../architecture.md#classifier-contract--metadata-fields)),
yet the entry schema declares `metadata.worldTime: number` as required
(non-nullable; see [`data-model.md → In-world time tracking`](../data-model.md#in-world-time-tracking)).
Something must initialize the field on `user_action` writes. The
[`entry-card.md` per-kind structure table](../ui/patterns/entry-card.md#per-kind-structure)
lists the world-time footer as "shown" on user entries, and the
post-2026-05-17-manual-worldtime-correction click-to-edit contract
gates on `worldTime` presence — both of which the gap leaves
ambiguous.

## Options considered

**A. Inherit at write time.** Action layer copies
`prev_entry.metadata.worldTime` onto the new user_action's metadata.
Stored value, no derivation; user-entries become editable on the same
terms as AI entries.

**B. Allow undefined.** Schema relaxes to `worldTime?: number`;
user-entries never carry one. Footer hides per the existing
"hidden when `worldTimeLabel` undefined" rule. Classifier base-lookup
must walk back past user-entries to find the most recent entry with a
defined `worldTime`.

**C. Defer with a future classifier pass.** A post-v1 tagging pass
over user_actions eventually fills in `worldTime`. v1 picks A or B
as interim.

## Decision — option A

Action-layer initialization: when a `user_action` entry is written,
its `metadata.worldTime` is set to the immediately preceding entry's
`metadata.worldTime`. Stored value, not derived. Footer renders.
Click-to-edit affordance applies on user entries on the same terms as
AI and opening entries.

### Why A

- **Schema stays clean.** `worldTime: number` required everywhere; no
  optional flag, no walk-back logic in the classifier's delta-base
  lookup.
- **Classifier contract stays simple.** "Added to the previous
  entry's `worldTime`" ([`architecture.md`](../architecture.md#classifier-contract--metadata-fields))
  keeps its plain meaning — N-1 is whatever's stored in slot N-1.
- **Reader rendering stays consistent.** Every entry shows when it's
  happening. A stretch of user-actions sharing one timestamp reads as
  "all in the same moment," which is what the prose depicts anyway.
- **Edit affordance generalizes.** Allows the user to nudge their own
  entry's time ("my character pondered for three hours") rather than
  silently accruing on the next AI reply's delta.
- **Cumulative monotonicity still works.** Inherited equals
  preceding ⇒ trivial flat ⇒ no monotonicity-indicator trigger.
  Manual user edits feed forward via the classifier's "delta added to
  prev" rule, naturally.

### Why not B or C

B introduces walk-back logic in the classifier's delta-base lookup
and a rendering inconsistency where user entries between two AI
entries show no time. Both costs land for no semantic gain — the
"undefined" position carries no authorial signal the inherit doesn't
already carry.

C punts without a forcing function. The schema requires the field
today; the resolution is needed before reader-composer integration
ships. A separate classifier pass over user-actions is a parked
post-v1 idea, but v1 needs a definite answer either way.

### Data-duplication cost

Option A carries an inherited number on every user-action entry —
identical to its predecessor's value at write time. Storage cost is
trivial (one int64 per entry). The duplication is the
straightforward concession that enables the cleaner contract. Future
extension: a user-triggered time-advance affordance on user entries
(authoring "this action took an hour") becomes a natural per-entry
edit rather than requiring a structural exception.

## Adversarial pass

- **First user-action after opening.** Opening is always entry 1 with
  `worldTime: 0`. `user_action[2]` inherits 0. Footer shows the origin
  time. No regression.
- **Consecutive user-actions.** `user[3]` inherits from `user[2]` which
  inherits from `AI/opening[1]`. All flat at the same value. Visually
  shows "all in the same moment" — consistent with the prose.
- **Classifier base after manual user-action edit.** User edits
  `user_action[3]` from `t=10` to `t=12`. Next AI reply's classifier
  reads prev (`user[3]`) = 12 and adds delta. Time progresses
  correctly from the user's chosen anchor.
- **Flashback prose with mid-flashback user-action.** Classifier
  emits `delta=0` on AI flashback entries → user-actions inside the
  flashback inherit the flashback-flat time. Consistent with
  "main-timeline clock doesn't advance during recalled scenes."
- **Edit cascade: user edits a preceding AI entry backward.**
  User-actions inheriting from before the edit hold their old (now
  potentially higher) value. The no-cascade contract is unchanged;
  the existing monotonicity indicator surfaces any real violation on
  the affected downstream entries.
- **Monotonicity check skip-zero interaction.** A user-action right
  after the opening inherits `worldTime: 0`. The check skips entries
  with `worldTime = 0` (existing flashback-skip convention). The
  user-action is treated as non-main-timeline by the indicator — a
  mild semantic stretch, but no false positives or false negatives.
  First AI reply that advances time anchors the main-timeline check
  from then on.
- **Edit-restrictions during in-flight generation.** Footer click on
  user-entries respects the `disabled` prop per
  [`principles.md → Edit restrictions during in-flight generation`](../ui/principles.md#edit-restrictions-during-in-flight-generation).
  No new mechanism.
- **Retrieval surface (pinned / out-of-order).** A surfaced
  user-action carries its frozen worldTime; renderable on its own,
  comparable in arithmetic, no special handling.

Verified: schema declaration ([`data-model.md`](../data-model.md#in-world-time-tracking)),
classifier-skip rule ([`architecture.md`](../architecture.md#classifier-contract--metadata-fields)),
footer rendering rule ([`entry-card.md`](../ui/patterns/entry-card.md#world-time-footer)),
monotonicity skip-zero rule ([`entry-card.md`](../ui/patterns/entry-card.md#world-time-footer)).
Assumed only: action layer reads prev entry's worldTime in the same
transaction as the user_action insert — trivial under single-writer
SQLite, implementation-side concern.

## Integration plan

- **`docs/data-model.md → In-world time tracking`** — add a paragraph
  on user_action `worldTime` initialization (inherit at write time)
  alongside the existing classifier / cumulative monotonicity
  invariant breakdown.
- **`docs/architecture.md → Classifier contract — metadata fields`**
  — add a sentence noting that user_action entries inherit at the
  action layer (no classifier pass), to resolve the "classifier
  doesn't run on user_action" gap in-place.
- **`docs/ui/patterns/entry-card.md → World-time footer`** — update
  the click-to-edit phrasing from "in practice on AI and opening
  entries" to include user entries. Per-kind structure table is
  already correct (footer "shown" on user).
- **`docs/followups.md → User-entry worldTime contract`** — remove
  the entry; resolved by this commit.

No wireframe changes. No renames. No new pattern adoption. No new
followups introduced (the inherit-at-write convention names the
authoring path cleanly; no deferrals).
