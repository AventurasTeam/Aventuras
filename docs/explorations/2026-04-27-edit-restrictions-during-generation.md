# Edit restrictions during in-flight generation (2026-04-27)

## Why this exists

A followup item — `Edit restrictions during in-flight generation`,
removed from `followups.md` by this exploration's integration —
asked for a uniform pattern covering calendar swap mid-generation,
story-settings edits during generation, and definitional changes
(mode / narration / lead) — surface kept ad-hoc, principle absent.
[`calendar-systems/spec.md → Adversarial check`](../calendar-systems/spec.md#adversarial-check)
already cites "the broader 'no settings edits during in-flight
generation' pattern" without anywhere defining it.

This exploration defines the principle, its enforcement contract,
and its user affordance. The design covers per-turn and chapter-close
pipelines for v1; background agents (style-review, future
standalone agents) get the **declaration interface** specified
here but pick their own gate behavior at their own design pass.

## The principle

> **A generation pipeline owns the live store from begin-transaction
> to commit (or abort). User-origin writes to story state and
> pipeline-relevant settings are blocked while a transaction is in
> flight. Cancel reverts the transaction and is always available.**

The constraint isn't UX — it's a coherence requirement between two
writers (user, pipeline) racing on the same Zustand store. Per
[`architecture.md → Pipeline principles`](../architecture.md#pipeline-principles),
phases read directly from `useStoryStore` / `useGenerationStore`
and the orchestrator dispatches actions that write back to the
same stores. The classifier writes deltas mid-turn (entities,
happenings, awareness links); a concurrent user edit to those same
slices would tear the read or overwrite the write. Hard-gating the
user during the window is the simplest answer compatible with the
single-store architecture.

## Scope — what's covered, what's not

**Covered (v1):**

- **Per-turn pipeline** — Pre → Retrieval → Narrative →
  [`[Classification ‖ Translation]`](../architecture.md#agent-orchestration) → Post. Triggered by user
  send / regenerate.
- **Chapter-close pipeline** — Boundary → Chapter metadata →
  Lore management → Memory compaction. Triggered by token-threshold
  cross at turn-commit time, or by explicit user close. Decided
  here as a **blocking pipeline** (was previously framed as
  "background"); the user is gated for its full duration with a
  prominent affordance.

Both transactions are atomic per their `action_id` (per
[`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback))
— a single CTRL-Z reverses an entire turn or chapter-close, and the
orchestrator uses the same reverse-replay machinery to abort
mid-flight.

**Not covered (deferred):**

- **Background agents** (style-review and any future agent that
  doesn't gate the user). The principle defines their declaration
  interface; each agent picks its own gate behavior at its own
  design pass.
- **Concurrent pipeline / agent coordination.** v1 invariant:
  at most one pipeline transaction at a time. The orchestrator
  enforces this (chapter-close is triggered only between turns;
  no overlap surface exists in v1).
- **Crash recovery.** A crash mid-transaction leaves a partially-
  applied `action_id` in the delta log. Recovery on next boot
  must replay-in-reverse. Architectural concern, separate design
  pass.

## Transaction lifecycle

Transaction state lives in the generation store:

```ts
type TransactionState =
  | { phase: 'idle' }
  | {
      phase: 'in-progress'
      kind: 'per-turn' | 'chapter-close'
      actionId: string
      abortController: AbortController
    }
```

Only the orchestrator transitions `phase`. User-origin actions
never set `in-progress` as a side effect of their own work.

**Begin.** Orchestrator calls
`useGenerationStore.beginTransaction({ kind })`. State transitions
`idle → in-progress`. A fresh `actionId` is generated. An
`AbortController` is created and stored. Pipeline phases begin.

**Phase writes.** Each phase emits events; the orchestrator
translates events to Zustand actions dispatched with
`source: 'pipeline'`. Every dispatched action carries the
transaction's `actionId`, which propagates to the delta log per
[`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback).
The action layer admits these (gate bypassed for `source: 'pipeline'`).

**Commit.** When the final phase completes, orchestrator calls
`useGenerationStore.commitTransaction()`. State transitions
`in-progress → idle`. The `actionId`'s deltas are now permanent
(subject to user CTRL-Z, the normal undo path). Stored
`AbortController` is discarded.

**Abort.** Triggered by user cancel, navigation away from the
story, or pipeline-level fatal error. Orchestrator:

1. Calls `abortController.abort()`. Every phase's
   `abortSignal.aborted` becomes true; LLM calls cancel; running
   generators return `{ aborted: true }` per
   [`architecture.md → AbortSignal threaded through everything`](../architecture.md#abortsignal-threaded-through-everything).
2. Reverse-replays the `actionId`'s deltas against SQLite + the
   live store. The undo information needed is the same the
   delta log records for user CTRL-Z (per
   [`data-model.md → Entry mutability & rollback`](../data-model.md#entry-mutability--rollback));
   abort is conceptually identical to user CTRL-Z, just unrolled
   by the orchestrator instead of the user on input.
3. Calls `useGenerationStore.abortTransaction()`. State
   transitions `in-progress → idle`. UI gate releases.

**Streaming partial entries.** Per
[`architecture.md → Why intermediates aren't persisted`](../architecture.md#why-intermediates-arent-persisted):
the narrative content streams into the AI entry's row as a
side-channel write; the `op=create` delta only commits at stream
completion. On abort, no `op=create` exists yet — the live-store
row is dropped, SQLite never wrote it, no delta to reverse for
the entry itself. (Classifier deltas, if any have already
fired, are reverse-replayed.)

**Atomic chained transactions.** When the per-turn pipeline
commits and the token threshold demands chapter-close, the
orchestrator chains the two transactions without yielding to user
input. The gate's UI state continues seamlessly: per-turn pill
transitions to chapter-close pill+banner. No window for the user
to slip an edit in between.

## Action-layer enforcement

Every mutation action takes a required `source: MutationSource`
field. No default; forgetting it is a TypeScript error.

```ts
type MutationSource = 'user' | 'pipeline'

const createEntity = (args: { data: EntityCreate; source: MutationSource }): MutationResult => {
  if (args.source === 'user' && useGenerationStore.getState().txState.phase === 'in-progress') {
    return { status: 'rejected', reason: 'pipeline-in-flight' }
  }
  // ... append delta with current actionId, write SQLite, update store
}
```

Required-source is the structural enforcement: drift is a
compile-time error, not a code-review concern. Tests bypass the
action layer via `setState` for setup; tests that exercise the
action layer pass `source: 'pipeline'` to act as the orchestrator.

The UI gate (disabled controls + tooltips, see below) is the
user-facing path. The action-layer rejection is defense in depth —
catches programmatic edits, IPC actions, future MCP exposure, and
mistakes in feature work. It is never expected to fire in a
working UI flow.

## User affordance

Three loci, calibrated to the user's attention state:

### Status pill (chrome) — universal

The status pill specified in
[`ui/principles.md → Top-bar design rule`](../ui/principles.md#top-bar-design-rule)
shows phase content for the active transaction
(`generating narrative…` / `closing chapter…`). It's already
listed as essential and present on every screen. **The pill is
made click-to-cancel** as part of this principle: clicking it
opens a small popover with `Cancel generation` (or
`Cancel chapter close`); single click in the popover triggers
abort. The pill's dimensions are stable (no inline X chevron) to
avoid layout flicker on transaction start / end.

### Banner (below chrome) — chapter-close only

Per-turn doesn't get a banner — the streaming narrative is the
ambient progress indicator and the composer's send/cancel button
is the eye-line action surface. Adding a banner per turn would
shift layout every reply.

Chapter-close gets a sticky banner below the top bar. Persistent
for the duration of the transaction; dismissed on commit / abort:

```
┌─────────────────────────────────────────────────────────────┐
│  Closing chapter: 2 of 4 — generating chapter metadata… [Cancel] │
└─────────────────────────────────────────────────────────────┘
```

Justification: chapter-close has no streaming narrative, runs
through 4 distinct phases over 30–60s+, and the user wasn't
necessarily attending when it triggered. The pill alone doesn't
carry enough; the banner carries phase progress + a primary
cancel locus.

The pill and banner aren't duplicate information — pill is
ambient, banner is deliberate. Both visible during chapter-close
is the design.

### Disabled controls + tooltips

Every editable control on every screen disables when a transaction
is in flight. This includes:

- Story Settings tabs (all editable fields).
- World / Plot detail-pane edits (save bars, inline edits).
- Branch operations (create, switch, rollback initiation).
- Calendar swap (when surfaced from Story Settings or wherever).
- Lead switch, mode switch, narration switch.
- Manual `worldTime` correction.
- Backup / export when surfaced from inside the story (Actions
  menu, Story Settings).

**Form save buttons disable too.** A form with multi-field input
should propagate the gate's disable state to its save button so
the user doesn't draft an edit they can't submit. Stand-alone
inline edits already disable at the input level; multi-field
forms need the explicit save-button gate.

Hover/focus on a disabled control reveals a uniform tooltip:

| Pipeline      | Tooltip copy                                 |
| ------------- | -------------------------------------------- |
| Per-turn      | `Generation is in flight. Cancel to edit.`   |
| Chapter-close | `Chapter close in progress. Cancel to edit.` |

Tooltip copy is principle-owned. Per-screen docs cite, don't
reinvent.

### Story-leave abort-confirm modal

Navigation that takes the user **out of the active story**
(story list, app settings, vault, another story) while a
transaction is in flight prompts a confirmation:

```
┌─────────────────────────────────────────┐
│  Generation in flight                   │
│                                         │
│  Leaving will cancel the in-flight      │
│  generation and revert any changes.     │
│                                         │
│       [Stay]    [Cancel & leave]        │
└─────────────────────────────────────────┘
```

`Stay` dismisses the modal; user remains on current screen,
generation continues. `Cancel & leave` triggers abort + revert,
then proceeds with the navigation. **Pack edits are naturally
covered by this path** — pack editing lives in the Vault, which
is out-of-story; entering the Vault triggers the modal, which
the user can accept or decline.

In-story navigation (reader ↔ World ↔ Plot ↔ Story Settings ↔
Chapter Timeline ↔ Branch Navigator) does **not** trigger the
modal. The user can move freely within the story while a
transaction runs; only crossing the story boundary (or
explicitly cancelling) ends the transaction.

### Read-only browsing stays open everywhere

Peek drawer, panel navigation, chapter timeline reads, branch
navigator reads, the streaming narrative itself — all work as
normal during a transaction. The user sees the store in motion as
the pipeline writes; that's the expected visual feedback for
streaming, and harmless for chapter-close.

## Background-agent declaration interface

This principle covers per-turn and chapter-close. Future
background agents (style-review and any standalone agent that
splits out of chapter-close) **declare** their gate behavior at
their own design time, against an interface this principle
defines.

### Two layers, kept separate

1. **Transactional write set.** _Every_ writing agent — including
   background agents — writes through the orchestrator's action
   layer with `source: 'pipeline'`, with deltas appended under an
   `action_id`. Free revertibility comes with the action layer.
   No exemptions.
2. **User-facing gate trigger.** _Some_ agents trigger the gate;
   others don't. Per-turn and chapter-close trigger. Background
   agents may or may not — declared per-agent.

The first layer is universal. The second is per-agent. The
principle owns the declaration shape; agents own the values.

### Declaration shape

When a new background agent is designed, its design pass MUST
specify four fields. The principle owns the shape; the values
are agent-specific.

| Field            | Values                                                         |
| ---------------- | -------------------------------------------------------------- |
| `writeSet`       | Code-side enumeration of action types the agent dispatches.    |
| `gateBehavior`   | `'hard-gate'` \| `'scoped-gate'` \| `'no-gate'`                |
| `conflictPolicy` | `'abort-self'` \| `'block-pipeline'` \| `'concurrent-allowed'` |
| `affordance`     | `'invisible'` \| `'pill-only'` \| `'pill-and-banner'`          |

`'hard-gate'` triggers the same gate per-turn / chapter-close
trigger; banner content describes the agent. `'scoped-gate'` will
gate only the agent's `writeSet` (machinery for that lands when
the first agent uses it). `'no-gate'` runs without restricting
user editing — appropriate when the agent's writeSet is genuinely
disjoint from anything user-editable (style-review writing to its
own output store).

`conflictPolicy` defines what happens when a per-turn or
chapter-close pipeline starts while this agent is mid-run. The
principle does **not** prescribe a default — wrong choice either
burns provider budget (`abort-self` on a 90-second compaction
every turn) or blocks the user (`block-pipeline` on a slow
agent). Each agent's design pass picks one with reasoning.

`affordance` matches the agent's gate behavior — invisible for
no-gate background work, pill-only for short visible work,
pill-and-banner for hard-gating agents.

### What's deliberately not declared

- **`readSet`** is intentionally absent. Per
  [`architecture.md → The single-context principle`](../architecture.md#the-single-context-principle),
  every agent in a context group receives the full `promptContext`;
  the Liquid template selects what it actually uses. Read-set is
  template-determined, pack-editable, and dynamic — not
  code-declarable. A static field would lie within a release of
  code and lie harder once packs are real. **Future scoped-gate
  design** must address read consistency separately; candidates:
  Liquid AST analysis at template load (extracts top-level
  variable references — a conservative superset bound), or a
  hard-gate fallback for any agent whose reads can't be
  statically bounded.
- **Defaults for any field.** Per-agent.

### Style-review as worked example (informative, not normative)

Style-review's actual declaration lands with style-review's own
design pass. As an illustration of the interface:

```ts
{
  writeSet: { styleReviews: 'append' },
  gateBehavior: 'no-gate',
  conflictPolicy: 'concurrent-allowed',
  affordance: 'invisible'
}
```

Reasoning: writes to its own output store (no overlap with
anything user-editable), reads only committed entries (tolerant
of in-flight per-turn pipeline writing the next entry — the
streaming entry isn't committed until per-turn commits), runs
alongside everything. This is the cleanest case the interface
accommodates.

## Followups generated

Adding to [`followups.md`](../followups.md):

- **Crash recovery for in-flight transactions.** A crash leaves
  a partially-applied `action_id` in the delta log. On next boot,
  recovery must replay-in-reverse to restore pre-transaction
  state. The principle assumes this hook exists; it doesn't ship.
  Belongs alongside startup / migration flow.
- **Background-agent gate declarations.** One per future agent
  (style-review, standalone memory-compaction if it splits out,
  etc.) — captured in their respective design passes.
- **Scoped-gate UI design.** Surface-level affordance for the
  partial-gate case lands when the first agent uses it.
- **Scoped-gate read-tracking strategy.** Liquid AST analysis vs
  hard-gate fallback for unbound templates. Decision point at
  scoped-gate's own design pass.
- **Concurrent pipeline / agent coordination.** When v1's
  single-writer invariant is relaxed.
- **Backup / export consistency.** Backup initiation reads the
  whole story state; if reachable via a path that doesn't already
  trigger the gate or the abort-confirm modal, the read may
  capture inconsistent state. Belongs to the backup design pass.

Resolving (removing from `followups.md`):

- `Edit restrictions during in-flight generation` — the principle
  defined here.

## Integration map

Where each piece lands when this design integrates:

- **`docs/ui/principles.md`** — adds the principle as a new
  top-level section. The user-facing contract: scope, two
  pipelines, affordance loci (pill, banner, disabled controls,
  story-leave modal), tooltip copy. Cites
  `architecture.md` for the implementation contract.
- **`docs/architecture.md`** — adds the implementation contract
  in or adjacent to "Pipeline principles": transaction lifecycle
  (begin / commit / abort, action_id, reverse-replay), the
  required-source action signature, atomic chained transactions,
  and the background-agent declaration shape.
- **`docs/calendar-systems/spec.md → Adversarial check`** —
  updates the inline "broader pattern" reference to anchor-link
  the new principle in `principles.md`.
- **Per-screen docs** (one-line cites under each screen's
  cross-cutting principles section):
  - [`reader-composer.md`](../ui/screens/reader-composer/reader-composer.md)
  - [`story-settings/story-settings.md`](../ui/screens/story-settings/story-settings.md)
  - [`world/world.md`](../ui/screens/world/world.md)
  - [`plot/plot.md`](../ui/screens/plot/plot.md)
  - [`chapter-timeline/chapter-timeline.md`](../ui/screens/chapter-timeline/chapter-timeline.md)
  - [`branch-navigator/branch-navigator.md`](../ui/screens/reader-composer/branch-navigator/branch-navigator.md)
  - [`rollback-confirm/rollback-confirm.md`](../ui/screens/reader-composer/rollback-confirm/rollback-confirm.md)
- **`docs/followups.md`** — removes the resolved entry; adds the
  six new followups listed above.

No wireframe updates required — the affordances (pill click,
banner, disabled controls, story-leave modal) are visual but
their pixel-fidelity treatment lands with the visual identity
session, not in the wireframe set.
