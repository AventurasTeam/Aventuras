# Piggyback as the user's switch

Who turns piggyback on, and how the user tells whether a model handles
the tagged block. Designed 2026-11-17 from the roadmap's M7.1 item
"Tagged-block capability detection is unspecified".

## Why

Piggyback fired only when the story's `piggybackMode` was on and the
narrative model carried a `taggedBlockReliable` capability flag. Nothing
set the flag for a real model: catalog detection reads only `embedding`
off the model id, App Settings has no badge for it, and only the dev
seed's mock model carries it. So every story paid the per-turn fallback
classifier, a second input pass about as large as the narrative's, on
every turn. Canon contradicted itself on how the flag would be set:
`piggyback.md` said "our curation + detection", and App Settings'
trust-the-user rule says "no probe call". Story Settings gated the
toggle on structured-output capability, which `piggyback.md` says is
not the mechanism. And the roadmap asked whether reliability degrades
as a story's context fills, which no probe at model-select time can
answer.

## Decisions

- **The user is the only switch.** The developer: the user gets full
  control over whether piggyback is on, vouched for or not; the app
  provides means to verify a model appears capable, and nothing happens
  as hidden magic. Rejected: the app trying piggyback on an unknown
  model and turning it off when failures pile up; a curated list; the
  app suggesting and the user confirming.
- **The evidence is the story's own turns** (a record in Story
  Settings), over a test button that sends one dry-run narrative call.
  Trying piggyback is itself the test, and a safe one since the
  fallback covers each failed turn, and only the record measures at
  the story's depth.
- **The default stays off**, and play testing sets the shipped one.
  Nothing has measured the block at its current size, and the
  narrative-quality risk under the fold is parked until signal; with
  no users until the MVP, waiting costs nothing.
- **`taggedBlockReliable` goes.** With no gate it has no reader.
- **No threshold warning.** A failed turn costs the block's few hundred
  output tokens on top of the fallback an off turn pays anyway, so
  piggyback stays the cheaper path until nearly every turn fails
  (arithmetic on token counts, not measured).

## The design

**The switch.** Piggyback fires when the story's `piggybackMode` is on;
the narrative model's capabilities don't enter. The toggle is never
disabled, its hint states the trade-off, and App Settings' story
defaults seed it, off as shipped. A narrative model change no longer
changes whether piggyback fires: the setting stays, and the record
shows the new model's turns apart. Switching mid-story is unchanged.

**The record.** Story Settings · Memory · Classifier shows it under the
toggle, for the active branch. It reads the branch's newest replies,
at most 200, and sorts each by metadata it already carries:

- **parsed**: `stateReport.layer` is `piggyback_tagged_block`;
- **fell back**: the narrative attempt left `failedFields`, not
  counting the fallback's own `classifier` entry;
- **cut off**: a fallen-back turn whose reply was cut short, carrying
  `cutOff` or, when the cut fell in its block, `stateReport.blockCutOff`
  (new);
- **not tried**: anything else, which piggyback being off leaves.

It shows the last 20 tried turns as one line per model
(`metadata.model`) with the three counts, then the five newest failed
turns, each with its failed fields and an `entry #n` link into the
reader. A turn the fallback recovered leaves the world-state toggle
plain, so the reader alone doesn't point at them. The record shows
earlier tries even with piggyback off, and says no turn has tried it
yet when it's on with none. App Settings' story defaults don't mirror
it.

**`blockCutOff`.** A reply cut inside its trailing block leaves no mark
today (`per-turn.ts` sets `cutOff` only for a cut in the prose, and
logs the in-block one). Without a mark, a max output that fits the
prose but not the block reads as "this model can't do it". The
narrative attempt writes `stateReport.blockCutOff: true` whenever the
reply's end cut its block, parsed or not; the record counts it only on
a fallen-back turn.

## Adversarial pass

**Load-bearing: trying piggyback is safe because the fallback recovers
every failed turn.** It holds for the turn's state, with two limits.
A failed fold isn't free of side effects: a block that fails one field
has already landed its visual changes, conditions and item moves before
the fallback runs
([`piggyback.md → Parse strategy and failure recovery`](../memory/piggyback.md#parse-strategy-and-failure-recovery)),
so a weak model's partial writes land on its failed turns, where the
old gate kept such a model from writing at all. And "parsed" isn't
"correct": the record measures the block's format, as the flag would
have, not what it extracts. Both are the class a parsed-but-wrong block
already belongs to, which the world-state panel shows per turn and play
judges. The record says "parsed", never "worked".

**Edge cases.** A regenerate, Retry or rollback removes a turn, so the
record reads only the turns that stand; regenerating failed turns hides
them, which is fair, since the record is evidence about the story as
it is. A story with piggyback off for thousands of turns would scan
every reply's metadata for 20 tries, hence the bound of 200. Two
providers serving one model id share a line, since `metadata.model`
is the id the call sent. A cut after `</state>` (in `<suggestions>`)
sets `blockCutOff` on a parsed turn, which the record ignores. Long
model ids truncate at phone width.

**Read sites of the flag.** Code: `resolvePiggybackFires` and its
callers, the description of `piggybackFires` in `templateContextMap.ts`
(shown to pack authors), a comment in `generation-context.ts`, the dev
seed, the mock server and its README, and the e2e harness's helper that
clears the flag. Canon: the gate's section in `piggyback.md` and every
link to it, `story-settings.md`, `architecture.md`'s layer table,
per-reply bullet and system-half sentence, `generation-pipeline.md`'s
conditional-phase example, `cadence.md`'s exception-path sentence,
`data-model.md`'s `piggybackMode` comment, and the parked
`<suggestions>` split, which named the flag.

**Missing perspectives.** Undo, rollback and fork: `blockCutOff` is
part of the entry's metadata and moves with it. Export: entry metadata
travels as it is. Translation: the record is chrome; model ids stay as
sent. The system half's cache: only the toggle now changes
`piggybackFires`, a user action. Prose quality under the fold isn't
something the record can show; the play-testing item measures it
before a default is set.

## Integration plan

**Canonical files:**

- `docs/memory/piggyback.md`
  - `## Capability gate` renamed `## When piggyback fires`, rewritten
    around the user's switch, the record and the default.
  - Its in-file link under Parse strategy.
- `docs/memory/classifier.md → Settings · Memory · Classifier panel`:
  a new `### Piggyback record`.
- `docs/memory/cadence.md` (the Cost bullet near the top): the
  exception-path sentence.
- `docs/memory/retrieval.md → Q3: Piggyback summary`: the link to the
  renamed section.
- `docs/memory/README.md`: the piggyback index line.
- `docs/data-model.md`
  - `piggybackMode`'s comment.
  - `stateReport.blockCutOff` in the shape, and a sentence beside the
    cut-off mark.
  - The link in `Entry mutability & rollback`'s AI-reply bullet.
- `docs/architecture.md`: `Agent orchestration`'s layer-table row, its
  per-reply classifier bullet and its re-roll link; the sentence in
  `System and user halves`.
- `docs/generation-pipeline.md → Key shape rules`: the conditional-phase
  example.
- `docs/ui/screens/story-settings/story-settings.md → Classifier`: the
  gate bullet replaced by the switch and the record.
- `docs/ui/screens/app-settings/app-settings.md → Story defaults ·
Memory`: no piggyback record there.
- `docs/implementation/roadmap.md`: the M7.1 detection item removed; a
  new M7.2 item to build the switch, `blockCutOff` and the record.
- `docs/implementation/milestones/03-memory-floor/slices/02-piggyback.md`:
  the two links to the renamed section, links only.
- `docs/followups.md → Tuning and play testing`: "Which way piggyback
  defaults"; the parked `<suggestions>` link re-pointed.
- `docs/parked.md`: "Split capability flag for `<suggestions>` parse
  reliability" renamed "Split the piggyback switch for `<suggestions>`"
  and reworded.

**Renames:** `piggyback.md#capability-gate` → `#when-piggyback-fires`;
`parked.md#split-capability-flag-for-suggestions-parse-reliability` →
`#split-the-piggyback-switch-for-suggestions`. The capability field
`taggedBlockReliable` is dropped (code only; canon never listed it).

**Patterns adopted on a new surface:** none. The record's link reuses
the reader's `jumpToEntry`, as the review window's entry links do.

**Followups resolved:** the roadmap's M7.1 "Tagged-block capability
detection is unspecified".

**Followups introduced:** "Which way piggyback defaults" under
Tuning and play testing; the M7.2 build item in the roadmap.

**Wireframes:** `story-settings.html` (toggle off with the new hint and
no "recommended", the record with demo states: never tried, mixed,
all parsed); `app-settings.html` (the story-defaults toggle likewise).

**Intentional repeated prose:** the toggle's hint in `story-settings.md`
and the record's summary there restate `classifier.md`'s spec in brief,
as the panel's other controls do.
