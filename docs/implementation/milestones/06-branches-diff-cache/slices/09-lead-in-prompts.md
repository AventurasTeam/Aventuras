# Slice 6.9 — The lead in prompts

## Metadata

- **Milestone:** [Milestone 6 — Branches + diff cache](../milestone.md)
- **Depends on:** [Slice 6.8](./08-per-branch-lead.md), for the flag, the
  `metadata.leadId` stamps, `resolveLead` by the flag and the DB lead
  read ([C10](../milestone.md#c10--the-leads-surface)).
- **Blocks:** none.
- **Contracts:** consumes C10; follows
  [C5](../milestone.md#c5--branch-scoped-store-reads)'s accessor rule
  when [Slice 6.2](./02-scoped-reads-redo.md) has landed,
  [C11](../milestone.md#c11--shared-files) (6.9 owns the projections
  and inputs in `generation-context.ts`, `periodic-classifier.ts` and
  `chapter-close-metadata-call.ts`, beside 6.2's filter lines and
  6.8's lead lines) and [C12](../milestone.md#c12--canon-and-flips).
- **Estimate:** about 13 plan tasks, at planning time (M5's plans held 3
  to 7 more than their estimates).

## Goal

Every prompt that shows past turns marks where the lead changed, so a
model never reads an older turn's "I" as today's lead. The chapter
metadata and part calls get the lead by name and the narration. Every
close task names the lead by handle, and its turns and `read_turns`
answers carry marks. Chapter summaries and happening descriptions are
told in the third person. A probe on the dev model, run before and
after, records whether the new wording holds.

## Background

Slice 6.8 makes the lead a flag on the branch's character row and
stamps each new entry with the lead it was written under; nothing in a
prompt reads the stamp yet. Every history names the branch's lead as it
is now, so after a switch, a turn written under the old lead reads as
the new one's. Canon's answer is the lead mark: one helper walks the
turns a prompt renders and marks the first turn of each run written
under a different lead, in that prompt's own id scheme. A story whose
lead never changed gets no marks. The chapter calls also lack the lead
and the narration today, and the summary rules tell a summary in the
narration's own person, which canon reverses: a summary or a happening
is recalled later under whatever lead the story has then.

## Required reading

- [`architecture.md → System and user halves`](../../../../architecture.md#system-and-user-halves),
  whole: the stable system half, the bundled pack's table of what
  each half holds, "Every history marks the user's turns" and "Every
  history marks where the lead changes", which this slice builds.
- [`architecture.md → The single-context principle`](../../../../architecture.md#the-single-context-principle),
  the bullets on scene state coming from one entry and on `entity.id`
  being a placeholder: why a projection carries the mark and never the
  raw stamp.
- [`architecture.md → Variable registry`](../../../../architecture.md#variable-registry-for-the-prompt-editor):
  projections and the two-way parity tests.
- [`data-model.md → The lead`](../../../../data-model.md#the-lead) and
  [Entry metadata shape](../../../../data-model.md#entry-metadata-shape)
  (`leadId`): what a stamp holds, that an absent stamp means the
  branch had no lead, and that a stamp naming a deleted character
  stays. Its merge writer goes under R4 (C10), so read a delete as the
  only way a stamped row disappears, whether or not the canon pass has
  landed.
- [`memory/classifier.md → What the classifier reads`](../../../../memory/classifier.md#what-the-classifier-reads),
  the lead bullet, and
  [What the classifier writes](../../../../memory/classifier.md#what-the-classifier-writes),
  the happening description's third person.
- [`memory/piggyback.md → Fallback classifier context`](../../../../memory/piggyback.md#fallback-classifier-context):
  the fallback names the lead after the roster.
- [`memory/chapter-close.md → Conversations`](../../../../memory/chapter-close.md#conversations),
  [Tools and writes](../../../../memory/chapter-close.md#tools-and-writes)
  (`read_turns`),
  [Phase 2](../../../../memory/chapter-close.md#phase-2--chapter-metadata),
  [Phase 3](../../../../memory/chapter-close.md#phase-3--lore-management)'s
  list and
  [3e](../../../../memory/chapter-close.md#3e--happenings-consolidation)'s
  mechanical merge.
- [`testing.md → Real-provider checks`](../../../../testing.md#real-provider-checks):
  the two probes, the evaluation set and how a check proves it can
  fail.
- [`followups.md → Tuning and play testing`](../../../../followups.md#tuning-and-play-testing),
  the prompt tuning item: the marks' wording and the third-person rule
  are bundled defaults that play tunes later.
- Milestone contracts [C10](../milestone.md#c10--the-leads-surface),
  [C11](../milestone.md#c11--shared-files) and
  [C12](../milestone.md#c12--canon-and-flips), and
  [Slice 6.8](./08-per-branch-lead.md) for the names it shipped.

## Scope: in

C10's names are whatever 6.8 shipped; this section calls them by role:
the branch's lead (`resolveLead` over an entity map), the DB lead read,
and the stamp (`metadata.leadId`).

**What this slice relies on** ([C10](../milestone.md#c10--the-leads-surface)):

- **Every entry is stamped.** 6.8's migration stamps each existing
  entry with its branch's flagged lead, and every path that creates an
  entry writes the stamp. So a missing stamp means the branch had no
  lead when the entry was written, and the helper reads it so.
- **A character an entry is stamped with survives a merge it is in**
  (R4, extended to every character a stamp on the branch names). No
  merge removes a row a stamp names or passes the flag, so a stamp
  names a missing row only after a delete, for the current lead and a
  former one alike.
- **The DB lead read** lives in `lib/db` or `lib/world`, which
  `lib/pipeline` imports; it may not import the `lib/actions` barrel.
- **Two flags read as no lead,** and the error is logged only outside
  the render path, by the actions and the pipelines: a correct redo
  shows a render-path selector both flags between two patches.
- **Projections carry the computed mark, never the raw stamp,** as C10
  pins and the paragraph on projections below builds.
- **The evaluation set's rows are stamped.** 6.8 stamps each window's
  entries with the window's lead in `scripts/classifier-eval/fixture.ts`
  (C11), so the existing windows render with no mark. This slice adds
  per-entry stamps only to its new switch window.

**The helper.** One pure function, in `lib/world/lead.ts` beside
`resolveLead` and exported through the `lib/world` barrel (see Open
questions, the marks' open terms). It takes the turns a prompt renders,
in render order, each with its stamp; the id of the lead the prompt
names, or null; and a lookup from an id to that character's current
name on the branch, undefined when the branch holds no such character.
It returns each turn's mark or none:

- A turn is compared with the turn before it, and the first turn with
  the named lead. Only a change gives a mark, so a run under one lead
  gets one mark, not one per turn.
- `{ id, name }` when the lookup finds the stamped character,
  `{ gone: true }` when it doesn't, and `{ none: true }` when the turn
  has no stamp. Under R4 a stamped character leaves the branch only by
  a delete, so `{ gone }` always follows a delete, of the current lead
  or a former one; never a merge.
- The helper reads no lead and logs nothing. Its caller names the lead
  through `resolveLead` or the DB read, where a double already reads as
  no lead and the error is logged by the pipeline, outside any render
  path (C10).
- Stamps are compared by id: two runs under two different deleted
  characters are two `{ gone }` marks.
- The id is the raw entity id. Each caller maps it into its prompt's
  scheme, below.
- Callers supply the lookup: an entity map from the store where the
  context builder reads the store, a DB read where it doesn't (the
  close).

**Projections carry the mark, never the stamp.** A turn's projection
gains `leadMark`, absent (not null) on an unmarked turn, so a
never-switched context is key for key what it was. The stamp itself
never reaches a context: `substituteIds` allocates a placeholder for
every id it walks (`lib/ids/substitute.ts:4-17`), so a stamp naming a
deleted character would put that row back in the id map. The paths:

- `generationContext`. `promptEntry`
  (`lib/pipeline/definitions/generation-context.ts:319-321`) projects
  `entries` (`:500`) and `lastTurns` (`:504`), and the helper walks each
  list on its own, from `lead` (`:513`), with `branchEntities` as the
  lookup. This covers the narrator, the fallback classifier and the
  suggestion refresh. The id is substituted in walk order: `entries` and
  `lastTurns` precede `entities` (`:505`), so a marked prompt numbers
  the marked character first. That is harmless; planning may move the
  two keys after `lead` to keep the roster's numbering.
- `classifierContext`. `WindowTurn` (`lib/classifier/window.ts:6-17`)
  gains the entry's stamp, read where the scene is read (`:51-63`).
  `buildClassifierContext` computes the marks from its `leadId` and its
  `entities`, with no new argument, so `scripts/classifier-parse-probe.ts`
  and `scripts/classifier-eval/render.ts` call it unchanged. `turns`
  follow the roster in the walk (`classifier-context.ts:116`), so no
  numbering moves.
- The chapter metadata and part calls. `buildChapterContext`
  (`lib/pipeline/definitions/chapter-context.ts:43-59`) takes the named
  lead and the lookup and marks `entries`, per part for a part's call.
  The call has no id map, so the mark carries no id (see Open
  questions, the marks' open terms).
- A close task's turns. `buildCloseTurns` (`chapter-context.ts:78-88`)
  marks each part's turns. Each mark's id becomes a close handle through
  `ctx.ids.show(id, name)` (`close-agent/ids.ts:39-43`) when the turns
  are built, so the handle is fixed before the part's first render and
  the system half holds across the part's tasks.
- `read_turns` answers. Each answered turn carries its mark, walked
  from the task's named lead over the answer's turns in position order
  (`close-agent/read-turns.ts:106-113`), its lookup a DB read by branch
  as the tool reads the turns. The handle comes from `show` with the
  name, not from the answer's id swap, which mints a handle with no name
  (`ids.ts:105-137`).

**`macro_story_entry`** (`lib/prompts/bundled/story-entry.ts`) gains an
`ids` parameter and prints a marked turn's mark on a line before the
turn, its `<user_turn>` tag included, saying who "I" and "you" are from
there. `{ gone }`, a character since deleted from the branch (under R4
a delete is the only way a stamped character leaves, current lead or
former), names no one, so the model credits nothing to that "I";
`{ none }` says the run had no lead. With `ids` on, the line holds
the id the way the surrounding prompt writes ids: bracketed in the
fallback (`[c1]`), bare in the close (`c1`). A second parameter or one
form that `CloseIds.idOf` already reads (`ids.ts:83-89`) settles it, at
planning. The includes that turn `ids` on: the fallback's two
(`piggyback-fallback-classifier.ts:87,92`) and `CLOSE_PROSE`
(`close-prose.ts:8`). The ones left off: the narrator
(`per-turn.ts:90`), the suggestion refresh (`suggestion-refresh.ts:48`),
the chapter metadata (`chapter-metadata.ts:51`) and the part
(`chapter-metadata-part.ts:24`). The wording is a bundled default.

**The periodic classifier** prints the mark in its turn header
(`lib/prompts/bundled/periodic-classifier.ts:116`), with the placeholder
id. Text that explains marks, such as the turn intro at `:113`, renders
only when a turn is marked, so a never-switched prompt keeps its bytes.

**The lead lines and their clause.** A line naming the lead adds
"except where a turn names another" only when a turn in that prompt is
marked:

- the fallback's (`piggyback-fallback-classifier.ts:23-24`), testing
  `lastTurns`;
- the periodic classifier's (`periodic-classifier.ts:108-111`), testing
  `turns`;
- the chapter metadata and part calls' new line, testing `entries`;
- every close task's new line, testing `closeTurns`, which a prose task
  holds in its system half.

The narrator and the suggestion refresh gain no lead line. Their only
naming of the lead is the narrator instructions' narration rule, in a
system half that must stay byte-stable and can't take a per-call clause
(see Open questions, the marks' open terms). The Happenings and
Awareness tasks show no turns, so their lead line takes no clause
(see Open questions, the clause in Happenings and Awareness).
`read_turns` answers and the periodic classifier's turn header carry
marks but hold no lead line.

**The chapter context's `lead` and `narration`.**

- `ChapterContext` (`chapter-context.ts:13-18`) gains `lead`, by name
  with no id, null when the branch has none, and `narration`, the
  story's `'first' | 'second' | 'third'`.
- `readMetadataInputs`
  (`lib/pipeline/definitions/chapter-close-metadata-call.ts:89-103`)
  reads both with its other inputs while its branch check holds: the
  lead through `resolveLead` over the store's entities, which is also
  the marks' lookup, and the narration from the open definition.
- The metadata and part templates' user halves render the lead and the
  narration before the turns, per the bundled table. The merge gets
  neither: `buildChapterMergeContext` (`:62-72`) is unchanged.

**The close's lead.**

- Each of the seven tasks' starts reads the branch's lead through 6.8's
  DB read, from `lib/db` or `lib/world`, as `storyModeOf` reads the mode
  (`close-agent/turns.ts:88-99`), and shows it with `ctx.ids.show`. A
  prose task's start also reads, by branch, the names of the characters
  its part's stamps name, for the marks' lookup.
- Each task's user half names the lead by handle and name between its
  instructions and its starting rows, from one shared source (a
  `chapter` macro, or a constant as `CLOSE_TASK_SYSTEM` is). The
  templates are `close-lore.ts`, `close-identity.ts`, `close-threads.ts`,
  `close-upkeep.ts`, `close-lifecycle.ts`, `close-happenings.ts` and
  `close-awareness.ts`.
- `close-instructions.ts` stays free of the lead. The roadmap entry's
  "`close-instructions` … naming the lead" is stale and isn't built.

**The third-person rule.** The summaries' and the close's wording is
canon's, told in the third person, naming each character as the prose
does, never "I" or "you" outside quoted speech, and the lead by name
where canon says "the lead included": in first- or second-person prose
the prose calls the lead "I" or "you", which "as the prose does" would
point at. It goes in:

- the three summary rules, which today say the reverse:
  `chapter-metadata.ts:39`, `chapter-metadata-part.ts:13`, and the
  merge's "keep the person they are told in" at
  `chapter-metadata-merge.ts:15`;
- the close's composite description (`close-happenings.ts:12`).

The periodic classifier's happening description rule
(`periodic-classifier.ts:17`) has its own, shorter sentence: "Tell it in
the third person, the lead included: never "I" or "you" outside quoted
speech, whatever person the story is narrated in, since it is recalled
later under whatever lead the story has then." It drops "naming each
character as the prose does", and the sentence ends the bullet. The
summaries and the close keep the full wording.

**The registry** (`lib/prompts/templateContextMap.ts`):

- `leadMark` documented on `generationContext`'s `entries` and
  `lastTurns` (`:95-110`), `classifierContext`'s `turns` (`:407-414`),
  and the chapter group's `entries` and `closeTurns` (`:578-625`): its
  three forms, the id in that prompt's scheme or absent, and that each
  list is walked on its own.
- The chapter group gains `lead`, whose `id` is the handle on a close
  task's render and absent on the metadata and part calls, and
  `narration`. Neither joins `CLOSE_ONLY_CHAPTER_VARIABLES` (`:775`);
  `narration` joins `DISPLAY_GROUPS`' `Story Config` (`:902`).
- The two `lead` descriptions that still say "or its lead dangles on
  this branch" (`:215-222`, `:471-478`) describe the flag. They are the
  slice's forward pointers.

**Fixtures.** A unit fixture with a lead and unstamped entries would
now render a `{ none }` mark on its first turn. Every fixture behind an
existing render test or snapshot gets stamps equal to its lead, so the
snapshots hold. The fixtures are those in `lib/prompts/bundled/*.test.ts`,
the context builders' tests and `lib/pipeline/definitions/__tests__/`.

**The never-switched baseline.** The slice's first commit adds
`lib/prompts/bundled/never-switched.test.ts` and its snapshot file,
`lib/prompts/bundled/__snapshots__/never-switched.test.ts.snap`, before
any prompt or context edit, so its snapshots are main's renders. The
test renders fixed contexts of a story whose lead never changed, so no
turn carries a mark, with a lead and in a no-lead case, through each of
these templates: the narrator, the fallback, the suggestion refresh, the
periodic classifier, the chapter metadata, part and merge calls, and
the seven close tasks. Later commits add the new variables (`lead`,
`narration`) to the test's contexts and update the snapshots, never
the contexts' turns. `git diff <first commit>..HEAD` on the snapshot
file is then the record of what the slice changed in a never-switched
prompt.

**Probe tooling.**

- A new window with a lead switch partway through, its entries stamped
  one by one, and checks that a fact from the old lead's turns goes to
  the old lead. Every other window takes 6.8's stamps from
  `fixture.ts` and renders with no mark.
- A third-person check over every window's happening descriptions,
  appended to every window as `refsResolve` is
  (`scripts/classifier-eval/index.ts:17-25`).
- Each new check is proven to hold and to fail, in
  `scripts/classifier-eval/checks.test.ts` or `windows.test.ts`.
- `pnpm probe:close` prints, and saves in `PROBE_OUT`, each run's
  chapter title and summary, which it doesn't today, so the summary's
  person can be read.

**The probe runs,** on the dev model, the capability floor, with the
figures kept in [Implementation notes](#implementation-notes):

- Before: on main with 6.8 merged and no prompt change of this slice's,
  scored with the new checks (run from a commit with the checks and not
  the prompt edits, or rescore the saved replies).
- After: the same runs on the slice's head.
- The classifier: `PROBE_EVAL=all` at 5 runs a window, and the parse
  probe on `br_hero_main` at its default 20.
- The close: `PROBE_OVERLAY=1` at 10 runs, for the bar and each run's
  summary.

**Canon edits** (C12), in the slice's PR:

- [`testing.md → Real-provider checks`](../../../../testing.md#real-provider-checks):
  the new window and check, and the close probe's summary output.
- [`architecture.md → System and user halves`](../../../../architecture.md#system-and-user-halves):
  a mark, and the chapter context's `lead`, carry no id where the
  prompt has no id map, if planning confirms the answer under Open
  questions, the marks' open terms.
- [`memory/chapter-close.md → Phase 3`](../../../../memory/chapter-close.md#phase-3--lore-management):
  the narration line, as the developer rules (Open questions).

## Scope: out

- **Every write of the flag or the stamp:** the migration's stamps, the
  stamp on each new `user_action`, `ai_reply` and opening, and the
  seeds' stamps (the dev seed, the dataset seed JSON, `long-branch`).
  [Slice 6.8](./08-per-branch-lead.md).
- **`resolveLead`, the DB lead read, the stamp's schema field** and
  every reader outside prompts (rail, peek, World, the awareness scope):
  [Slice 6.8](./08-per-branch-lead.md), by C10.
- **A merge and a stamped character:** the collision dialog's fixed
  surviving row and the refusal of a merge whose losing row is flagged
  or named by a stamp (R4). [Slice 6.8](./08-per-branch-lead.md).
- **Stamping the evaluation set's rows:** 6.8, in
  `scripts/classifier-eval/fixture.ts` (C11).
- **The fork's copy of the flag and the stamps,** and the lead switch
  in the fork's harness: [Slice 6.3](./03-fork-core.md) and Slice 6.8,
  by C3 and C10.
- **Story Settings' lead field, `No lead` and the other-branches
  line:** M7.2.
- **The chapter boundary call:** it shows candidates' first and last
  sentences, not a history, and canon names no mark there. Not built.
- **The merge call's lead, narration and mode:** canon gives it none.
- **The wizard's templates:** no history to mark.
- **A person rule for other AI-written text:** the per-turn
  `<summary>` line, the fallback's one-sentence turn summary, entity
  descriptions, traits and lore. Canon gives them none; play checks
  whether they need one
  ([`followups.md → Tuning and play testing`](../../../../followups.md#tuning-and-play-testing)).
- **The narrator never copying a mark into its prose:** play, the same
  item.
- **Story export and import of the flag:** later milestones' export
  work.

## Acceptance criteria

Unit tests run with `pnpm vitest run --project unit <path>`.

- **The helper** (`lib/world/lead.test.ts`):
  - all stamps equal to the named lead give no mark;
  - a switch marks the first turn of each run only;
  - the first turn is marked when it differs from the named lead;
  - a deleted character gives `{ gone }`, a former lead as the current
    one, and a missing stamp `{ none }`;
  - two deleted characters in a row give two marks;
  - a null named lead with unstamped turns gives none.

  Each assertion fails with the rule it checks removed (a mutation
  check, restored by `cp`).

- **Never switched.** The milestone's Definition of done: "A story
  whose lead never changed gets no mark and no "except where a turn
  names another" clause in any prompt: the paths that only gain marks
  render as before, and the paths canon gives new lines (the chapter
  calls' lead and narration, each close task's lead line, the
  third-person rule) change in those lines alone." Checked as:
  - **No mark, no clause.** Given a story whose every stamp names the
    named lead, each builder emits no `leadMark`:
    `buildGenerationContext` (`generation-context.test.ts`),
    `buildClassifierContext` (`classifier-context.test.ts`),
    `buildChapterContext` and `buildCloseTurns`
    (`chapter-context.test.ts`) and `read_turns`
    (`close-agent/read-turns.test.ts`). No render in
    `never-switched.test.ts` holds a mark line or the clause, the
    no-lead case included.
  - **The mark-only paths render as before.** With fixtures stamped
    with their lead, no existing snapshot changes in
    `lib/prompts/bundled/__snapshots__/per-turn.test.ts.snap` or
    `piggyback-fallback-classifier.test.ts.snap`, and the narrator's,
    the fallback's and the suggestion refresh's snapshots in
    `never-switched.test.ts.snap` are byte-equal to the slice's first
    commit.
  - **The paths with new lines change in those lines alone.**
    `git diff <first commit>..HEAD -- lib/prompts/bundled/__snapshots__/never-switched.test.ts.snap`
    changes only these lines: the periodic classifier's happening rule
    (system half); the chapter metadata and part calls' summary rule
    (system half) and their lead and narration lines (user half); the
    merge's summary rule; each close task's lead line (user half), with
    a prose task's system half unchanged; and the Happenings task's
    description rule.
  - `git diff main -- lib/prompts/bundled/__snapshots__/` changes no
    other existing snapshot beyond the periodic classifier's happening
    rule, and adds the switched cases and the baseline file.
- **Switched, per path.** A fixture with a switch, stamps under A then
  B with B the named lead, renders as follows. "Mark" means a mark on
  the first turn of each run, and on no other turn.
  - **The narrator and the suggestion refresh:** a mark line before
    each run's first turn, naming the character with no id. No clause
    anywhere in the render, since they hold no lead line.
  - **The fallback:** a mark line with the bracketed placeholder, and
    the clause on its lead line.
  - **The periodic classifier:** the mark in the turn header with the
    placeholder, the text explaining marks, and the clause on its lead
    line.
  - **The chapter metadata call and a part's call:** a mark line naming
    the character with no id, and the clause on the new lead line. A
    part with no switch inside it, whose turns all match the named
    lead, has neither.
  - **A close prose task:** a mark line with the close handle in the
    turns of its system half, and the clause on the lead line of its
    user half.
  - **The Happenings and Awareness tasks:** no turns, so no mark, and
    their lead line without the clause.
  - **A `read_turns` answer:** the mark on each run's first answered
    turn, with the close handle. No lead line, so no clause.

  `{ gone }` and `{ none }` each render in at least one path's test.

- **No raw id.** A mark naming a deleted character allocates no
  placeholder: after `buildGenerationContext` and
  `buildClassifierContext`, the id map holds no entry for its id
  (`generation-context.test.ts`, `classifier-context.test.ts`).
- **The close's stability.** In
  `lib/prompts/bundled/system-half-stability.test.ts`:
  - a part with a marked turn renders the same system half for each of
    its tasks;
  - `close-instructions` reads neither `lead` nor `narration`, which
    the stable-variable filter would hide (`:21-29`), so the assertion
    reads the macro's globals directly;
  - `narration` joins the stable-variable list, or the render cases set
    it apart in both contexts.
- **The close's lead.** Each of the seven tasks' user half names the
  lead by handle and name, resolved from the DB with no story's stores
  loaded (`close-agent/turns.test.ts`, "the close tasks' starts and
  renders"). A branch with no lead names none, and the task still
  runs.
- **The chapter context.** `chapter-context.test.ts`:
  - the metadata and part templates read `lead` and `narration`;
  - `buildChapterContext` emits both;
  - the merge reads neither.
- **Parity.** `generation-context.test.ts`, `classifier-context.test.ts`,
  `chapter-context.test.ts` and `lib/prompts/templateContextMap.test.ts`
  pass with the new variables. `rg -n "dangles on this branch" lib/`
  prints nothing.
- **Third person.** A test per template asserts the rule's text in each
  of the five sources. Both of these print nothing:
  - `rg -n "narration's own person" lib/prompts`
  - `rg -n "keep the person they are told in" lib/prompts`
- **Probe tooling.** `checks.test.ts` shows each new check holding and
  failing. Rendering an existing window prints no mark line. A
  `pnpm probe:close` run prints each run's chapter title and summary
  and saves them in `PROBE_OUT`.
- **Canon.** The PR's `docs/testing.md` diff describes the switch
  window, the third-person check and the close probe's summary output,
  and each canon edit planning confirms (Scope: in) lands in the same
  PR.
- **Probes recorded.** Implementation notes hold, before and after:
  - each window's check rates, the new ones included;
  - the parse probe's first-attempt parse rate;
  - the close bar's verdict, and how many runs' summaries used "I" or
    "you" outside quoted speech.

  Any rate that fell is raised with the developer before the PR merges.

- **Gates.** `pnpm lint`, `pnpm format:check`, `pnpm compiler:check`,
  `pnpm typecheck`, `pnpm lint:docs` and `pnpm test:run` pass.

## Tests

- **Vitest, unit:** the helper as a pure function, on inputs that can
  fail, with expectations written out, never derived from the helper.
  The window's stamp in `lib/classifier/window.test.ts`.
- **Vitest, render level:** the bundled templates' tests and snapshots,
  the never-switched baseline (`never-switched.test.ts`, committed
  first), each context builder's parity and shape tests, the close's
  starts and renders, `read_turns`, and the system-half stability
  suite. These hold the never-switched and switched cases above.
- **Vitest, scripts:** the evaluation set's new checks.
- **Real-provider probes,** manual, on the dev model, before and after,
  as Scope: in sets out.
- **No E2E.** Nothing crosses a process or platform seam: the marks are
  context and template work that unit renders cover, and the probes
  measure the wording against a real model.
- **No Storybook:** no UI. No new chrome string either. Prompt text is
  pack content, not `t()` copy.

## Open questions

Slice planning (2026-11-25) answered each of these, and the before and
after probes the one on the new wording;
[Implementation notes](#implementation-notes) carries the answers.

- **The marks' open terms.** Canon settles none of these.
  Recommended answers, which the scope above follows; planning
  confirms each with the developer.
  - _`leadMark.id` where a call has no id map._ The chapter metadata and
    part calls render with no substitution, and the registry calls
    their threads "no ids, so the call needs no placeholder map". The
    mark there carries no id, and so does the chapter context's `lead`.
    A raw id would reach a pack.
  - _Whether the narrator and the suggestion refresh gain a lead line._
    Recommended no. Canon's clause belongs to "a line naming the lead …
    in a user half". These two name the lead only in the narrator
    instructions, in a system half that must stay byte-stable, and the
    mark line itself says who "I" and "you" are from there.
  - _The helper's home and its names._ `lib/world/lead.ts`, beside
    `resolveLead`, reachable from `lib/pipeline` (which already imports
    `@/lib/world`). Each caller supplies the name lookup: store-backed
    builders their entity map, the close a DB read.
  - _The close's lead from the DB._ Settled by C10: 6.8's DB read, in
    `lib/db` or `lib/world`.
- **The new wording on the dev model.** The marks, the clause and
  the third-person sentences are new instructions in classifier and
  close prompts tuned to the capability floor. The probes say whether
  they hold. A miss reopens the wording, not the slice.
- **The narration in close tasks.** Phase 3's list gives each task "the
  branch's lead by handle and name, and the narration"; Conversations
  and the bundled table give the lead alone. The scope follows the
  table, since the lead line already says whose "I" and "you" the
  turns are. If the developer wants the narration there, every close
  template reads `narration` too. Either way the PR aligns Phase 3 with
  the table.
- **The clause in Happenings and Awareness.** Neither task shows turns,
  so by canon its lead line never takes the clause, while a
  `read_turns` answer can carry marks. The mark says who "I" is from
  there, so the line can stay flat. The alternative is a wording that
  always allows for marks in what the task reads.
- **A fallback mark naming a character its roster leaves out.** The
  fallback's roster lists active and staged rows
  (`piggyback-fallback-classifier.ts:14-21`). A mark naming a retired
  former lead would print a placeholder the roster doesn't show, which
  a reply could then write. The choice is to print the name alone
  there, or to accept it.
- **A close probe with a switch.** The scope's close probe runs the
  dataset seed, which has no switch, so the close's marks meet a real
  model only through the unit renders. An overlay that re-stamps the
  chapter's second half with another character would probe them; it is
  optional, at planning.
- **The pipelines' read is `resolveLeadLogged`, not `resolveLead`.**
  The scope names `resolveLead` as the pipelines' read: the helper's
  caller names the lead through it, with the double "logged by the
  pipeline", and `readMetadataInputs` reads the chapter context's lead
  through it. Slice 6.8 split the read to keep C10's render-path rule:
  `resolveLead` is silent, for render paths, and `resolveLeadLogged`
  (`lib/world/lead.ts`) logs a double as `pipeline.lead_double`, with a
  `site`, as the generation and classifier contexts already read it.
  Read through `resolveLead`, the chapter context would take a double
  as no lead and log nothing. The DB read, `readBranchLead` (`lib/db`),
  logs its double as `action_layer.branch_lead_double`, whose
  [observability entry](../../../../observability.md#subsystem-emission-inventory)
  doesn't name the close. Default: the store-backed pipeline reads
  go through `resolveLeadLogged`, and the close through `readBranchLead`
  as shipped, with that entry gaining the close. Found by Slice 6.8's
  slice review (2026-11-25).

## Implementation notes

**Developer decisions (slice planning, 2026-11-25).**

- **Q1. No id where a call has no id map.** In the chapter metadata and
  part calls a mark naming a character is `{ name }`, and the chapter
  context's `lead` is `{ name }`: those calls render with no
  substitution, so an id there would be a raw entity id reaching the
  pack. A namesake switch reads ambiguously there, accepted, since the
  summary names its characters anyway.
- **Q2. The narrator and the suggestion refresh explain their marks.**
  They take marks and no lead line or clause, as the slice set out, and
  Story so far opens with one explainer line when a turn in it is
  marked: no probe reaches the narrator, and its system half's
  unqualified "'I' is the lead" competes with the marks. The line never
  claims the latest run is today's lead's, since after a switch with no
  turn since it is not. The suggestion voice names the lead for the
  next turn's voice, always today's lead's, so it takes no clause
  either.
- **Q3. The close tasks name the lead, not the narration.** No close
  task writes text whose person follows the narration. Phase 3's list
  dropped "and the narration", matching Conversations and the bundled
  table.
- **Q4. Happenings and Awareness keep a flat lead line.** A
  `read_turns` answer holding a marked turn opens with an explainer
  note instead. An always-on clause would reach never-switched prompts,
  and a per-task query of the branch's stamps was declined.
- **Q5. A fallback mark prints its placeholder whatever the
  character's status,** as the fallback's lead line already does for a
  retired lead; the reply schema has a returning retired character's
  flip. Assumed, not traced: a reply naming that placeholder resolves
  and lands as any write to a retired row does.
- **Q6. No close probe with a switch.** On the dataset a re-stamped
  half would contradict Jim's first-person prose, the bar scores holds
  and coverage rather than attribution, and R4 would refuse Identity
  merges of the stamped character and move the coverage counts.
- **Q7. The dataset seed is narrated in the first person.**
  `treasure-island.seed.json` carries `narration: 'first'`, set before
  the before runs, so the close probe tests a first-person story whose
  summary must still be third person. The build's wizard drive still
  leaves the wizard's default, third person, so a rebuild reverts it;
  the fix is filed in
  [`triage.md`](../../../triage.md).
- **Canon route.** The Q1, Q2 and Q4 sentences and Q3's list edit
  landed in this PR beside the slice's own canon edits, with no design
  pass.

**Developer decisions (during the run).**

- **The `switch` window's former lead.** "PROVISIONAL: (B), give Wenna a
  description unrelated to locks … so the switch window measures the
  marks rather than an inference from her description." Wenna is
  described as "A chandler's widow who rents the room above her shop."
  where the plan's fixture had "A locksmith's daughter who opens doors
  for a price." It was set before the before runs and is the same in the
  after runs. Provisional: the window's attribution figures rest on it.
- **The close's after run.** Claude Code's low-memory reaper killed the
  first after run at about 15:10Z, three minutes into run 1. "Q20: A /
  50GB of memory free, should be fine": it reran alone as a normal
  background shell, and that rerun's figures are the ones below.
- **The close keeps the summaries' wording.** ANSWER (the close's
  Happenings): "keep the close's Happenings on THIRD_PERSON_RULE … add
  one clause to docs/memory/chapter-close.md 3e saying the close keeps
  the summaries' wording rather than the pass's." The clause is in
  3e's `description` bullet; no close rerun, its rule is untouched.
- **The classifier's wording, in order.** The first wording, the
  summaries' `THIRD_PERSON_RULE` also in the periodic classifier, made
  six checks fall at 5 runs (the Falls paragraph below). "Q21: B":
  five more runs of the four windows with a falling check, a side;
  each fall held at 10 runs. "Q23: C1": reword only the periodic
  classifier's happening bullet, dropping "naming each character as the
  prose does" and keeping "the lead included"; the summaries and the
  close keep `THIRD_PERSON_RULE`. `classifier.md`'s sentence changed
  with it, because the 10-run figures showed the longer phrase
  coinciding with unnamed figures made into new characters (`ambush`,
  the archer and the third rider, never named: 9/10 → 6/10 at 10 runs,
  8/10 under C1, in the Probes table). At 10 runs C1 was still more
  than one run below before on four checks, so "Q27:
  D2": ten more runs a side of `learning` and `recounted`, and a test
  fixed before the numbers, a two-sided Fisher exact test per check,
  before (20 runs) against the variant (20 runs), accepting the variant
  unless any `learning` or `recounted` check is lower under it at p
  under 0.1. C1 failed it on "the poisoning is not added again", 19/20
  to 14/20, p = 0.091.
  "Q29: E2": move the classifier's sentence to the end of the bullet,
  the same words; `classifier.md` mirrors the order. E2 passes the same
  test (20 runs, `learning` and `recounted`): no check is lower at
  p under 0.1, and the poisoning check is 19/20, level with before.

**Implementer choices worth keeping.**

- `macro_story_entry` takes a required `ids` argument, `false`,
  `'bracketed'` or `'bare'`, passed at every include: LiquidJS reads an
  include argument left out as a free global, which the registry and
  the stability tests reject.
- `generationContext` lists `entries` and `lastTurns` after `lead`, so
  a marked character takes the placeholder the roster gives it.
- The pipelines' lead reads, the slice's last open question: the
  store-backed builders, `readMetadataInputs` among them, read through
  `resolveLeadLogged`, and the close through `readBranchLead`, whose
  [`branch_lead_double`](../../../../observability.md#subsystem-emission-inventory)
  entry now names the close. `data-model.md → The lead`'s Readers
  paragraph names the close as a `readBranchLead` caller.
- The close reads its lead per task, and `read_turns` per call, with no
  carrier on `ToolContext`: nothing moves the flag during a close. The
  close runs under a hard gate (`chapter-close.ts:40`), Set as lead and
  a delete refuse under it (`set-lead.ts:97`), and no machine writer
  touches the flag, so every read in one close returns the same lead
  and a part's system half stays byte-stable. A prose task's marks and
  lead line share one read. A carried field would have added a required
  key to 53 literal test contexts.
- The summaries' rule says "the lead by name" where canon says "the
  lead included": in first- or second-person prose the prose calls the
  lead "I" or "you", which "as the prose does" would point at. The
  classifier's sentence, C1's, says "the lead included" as canon does.
- The person detector (`scripts/classifier-eval/person.ts`), shared by
  the evaluation set's third-person check and the close probe's count:
  the word-bounded `I`, `me`, `my`, `mine`, `myself`, `we`, `us`, `our`,
  `ours`, `ourselves`, `you`, `your`, `yours`, `yourself` and
  `yourselves`, case-insensitive except `I`, outside straight or curly
  double quotes; a single quote is an apostrophe.
- Probe order: the never-switched baseline, the probe tooling, the
  before runs at that commit, the prompt work, the after runs. Main had
  no switch window, no summary output and no saved replies to rescore.
- Task 15's plan wrote the stems "narration's own person" and "keep the
  person they are told in" into the negative assertions of
  `third-person.test.ts`, a file under `lib/prompts`, so the literal
  phrases sat where its own step and this slice's Acceptance criteria
  run `rg` and want neither found. The assertions use "own person" and
  "person they are told in", which the old text carried and the rule's
  text does not.

**What a later slice builds on.**

- `leadMarks`, `leadStampOf` and `LeadMark` in `lib/world`;
  `readEntityNames` in `lib/db`.
- `THIRD_PERSON_RULE` and `CLASSIFIER_THIRD_PERSON_RULE`
  (`lib/prompts/bundled/third-person.ts`), the sources of the rule: the
  first in the three summary templates and the close's Happenings, the
  second in the periodic classifier.
- The chapter group's `lead` and `narration`, and the close's
  `TaskTurns.lead`.
- Open in [`followups.md`](../../../../followups.md#tuning-and-play-testing):
  whether a model credits a mark that names no lead to today's lead
  (added with the review's finding); and in
  [`triage.md`](../../../triage.md), the entries this slice filed: the
  evaluation set's appended checks are unpinned, the dataset build
  leaves the story in the third person, a stranded comment above
  `leadOf`, and `data-model.md` calling a context's missing lead
  "absent" where the builders pass `null`.

**Probes.** On the dev model `Gemma4-26B-A4B-QAT-MTP`, before at
`510af826c` (the probe tooling, no prompt change) and after at
`222d11765` (the first wording; the commits after it, up to the C1
reword, add only comments and docs). The close runs read one seeded
database, its sha256 the same in both. The third-person check's before
figures had no rule in the prompt behind them. Evaluation set, 5 runs a
window: every check's rate before, under the first wording and after C1
(`dcbb6c948`):

| Window         | Check                                                                                                            | Before          | First wording | C1        |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | --------------- | ------------- | --------- |
| `ambush`       | parsed                                                                                                           | 5/5             | 5/5           | 5/5       |
| `ambush`       | expect rule: Dov Hask is a new character                                                                         | 5/5             | 5/5           | 5/5       |
| `ambush`       | expect rule: the fight is one happening, not one a beat                                                          | 4/5             | 5/5           | 4/5       |
| `ambush`       | expect rule: a happening tells the fight’s moments: Hask unhorsed, the archer shot, Sefa’s wound                 | 5/5             | 5/5           | 5/5       |
| `ambush`       | expect rule: a happening sits at t4, the fight’s last turn                                                       | 5/5             | 5/5           | 5/5       |
| `ambush`       | expect rule: a happening involves Tobin, the prose’s "you"                                                       | 5/5             | 5/5           | 5/5       |
| `ambush`       | avoid rule: Pell, never in the prose, is involved in no happening                                                | 5/5             | 5/5           | 5/5       |
| `ambush`       | avoid rule: no happening’s description tells Pell in the fight                                                   | 5/5             | 5/5           | 5/5       |
| `ambush`       | expect rule: a happening involves Sefa                                                                           | 5/5             | 5/5           | 5/5       |
| `ambush`       | expect rule: a happening involves the crossing, where it happened                                                | 5/5             | 5/5           | 5/5       |
| `ambush`       | avoid rule: Sefa, wounded, is not retired                                                                        | 5/5             | 5/5           | 5/5       |
| `ambush`       | avoid rule: no new character stands for "you"                                                                    | 5/5             | 5/5           | 5/5       |
| `ambush`       | avoid judgment: the archer and the third rider, never named, are not new characters                              | 4/5             | 3/5           | 4/5       |
| `ambush`       | avoid rule: knownAwareness names only a listed happening                                                         | 5/5             | 5/5           | 5/5       |
| `ambush`       | avoid rule: every ID names a listed row or a handle the reply declares                                           | 5/5             | 5/5           | 5/5       |
| `ambush`       | avoid rule: happening descriptions in the third person                                                           | 5/5             | 5/5           | 5/5       |
| `recounted`    | parsed                                                                                                           | 5/5             | 5/5           | 5/5       |
| `recounted`    | expect rule: the wreck is a recounted happening, with its time                                                   | 5/5             | 5/5           | 5/5       |
| `recounted`    | expect rule: Nessa learns of the wreck, with learnedAtTurn                                                       | 5/5             | 5/5           | 5/5       |
| `recounted`    | expect rule: Brannoc, who watched it, is aware of the wreck                                                      | 5/5             | 5/5           | 5/5       |
| `recounted`    | expect rule: Edric Vane is a new character                                                                       | 5/5             | 5/5           | 5/5       |
| `recounted`    | expect rule: Vane, who gave the order, is involved in the wreck                                                  | 4/5             | 2/5           | 1/5       |
| `recounted`    | expect rule: Nessa’s resolve to take the page to court is a new thread                                           | 5/5             | 5/5           | 5/5       |
| `recounted`    | avoid rule: the wreck is one happening: the doused lamp is a moment of it, not its own                           | 5/5             | 5/5           | 5/5       |
| `recounted`    | avoid rule: knownAwareness names only a listed happening                                                         | 5/5             | 5/5           | 5/5       |
| `recounted`    | avoid rule: every ID names a listed row or a handle the reply declares                                           | 5/5             | 5/5           | 5/5       |
| `recounted`    | avoid rule: happening descriptions in the third person                                                           | 5/5             | 5/5           | 5/5       |
| `reveal`       | parsed                                                                                                           | 5/5             | 5/5           | 5/5       |
| `reveal`       | expect rule: the woman in grey is renamed Ilse Marrow                                                            | 5/5             | 5/5           | 5/5       |
| `reveal`       | expect rule: the Heron is an alias of hers                                                                       | 4/5             | 5/5           | 4/5       |
| `reveal`       | expect rule: her cover name, Mistress Penn, is an alias of hers                                                  | 0/5             | 0/5           | 0/5       |
| `reveal`       | avoid rule: no new character for her, under any of her names                                                     | 5/5             | 5/5           | 5/5       |
| `reveal`       | avoid rule: the cover name renames no one                                                                        | 5/5             | 5/5           | 5/5       |
| `reveal`       | avoid judgment: the passing fishmonger is not a new character                                                    | 5/5             | 5/5           | 5/5       |
| `reveal`       | expect rule: the meeting in the market is one happening, not one a beat                                          | 5/5             | 5/5           | 5/5       |
| `reveal`       | expect rule: a happening tells the meeting’s moments: the cornering, her name, the note                          | 5/5             | 5/5           | 5/5       |
| `reveal`       | avoid rule: knownAwareness names only a listed happening                                                         | 5/5             | 5/5           | 5/5       |
| `reveal`       | avoid rule: every ID names a listed row or a handle the reply declares                                           | 5/5             | 5/5           | 5/5       |
| `reveal`       | avoid rule: happening descriptions in the third person                                                           | 5/5             | 5/5           | 5/5       |
| `defection`    | parsed                                                                                                           | 5/5             | 5/5           | 5/5       |
| `defection`    | expect rule: Brann ends the window in House Varro                                                                | 5/5             | 5/5           | 5/5       |
| `defection`    | expect rule: his membership sits at t2, where he swears                                                          | 5/5             | 5/5           | 5/5       |
| `defection`    | avoid rule: Maela’s borrowed coat changes no membership of hers                                                  | 5/5             | 5/5           | 5/5       |
| `defection`    | avoid judgment: no new character but the warrant’s signer: the gate-boy and the hanged brother go unnamed        | 5/5             | 5/5           | 5/5       |
| `defection`    | avoid rule: no new faction for a listed one                                                                      | 5/5             | 5/5           | 5/5       |
| `defection`    | expect judgment: the ledger theft is a happening involving Brann and Maela                                       | 5/5             | 5/5           | 5/5       |
| `defection`    | expect rule: a happening involves the toll-house, where the theft happened                                       | 5/5             | 5/5           | 5/5       |
| `defection`    | avoid rule: the hanging carries no time worked out from other numbers                                            | 4/5             | 5/5           | 5/5       |
| `defection`    | avoid rule: the alehouse bargain is one happening, not an offer and an acceptance                                | 5/5             | 5/5           | 5/5       |
| `defection`    | avoid rule: knownAwareness names only a listed happening                                                         | 5/5             | 5/5           | 5/5       |
| `defection`    | avoid rule: every ID names a listed row or a handle the reply declares                                           | 5/5             | 5/5           | 5/5       |
| `defection`    | avoid rule: happening descriptions in the third person                                                           | 5/5             | 5/5           | 5/5       |
| `learning`     | parsed                                                                                                           | 5/5             | 5/5           | 5/5       |
| `learning`     | expect rule: Idris learns of the listed poisoning                                                                | 5/5             | 5/5           | 5/5       |
| `learning`     | expect rule: Oriel, who tells of the poisoning, knows of it                                                      | 3/5             | 4/5           | 4/5       |
| `learning`     | expect rule: his learning sits at t2                                                                             | 5/5             | 5/5           | 5/5       |
| `learning`     | avoid rule: the poisoning is not added again                                                                     | 5/5             | 3/5           | 4/5       |
| `learning`     | avoid rule: the listed master and apprentice views are not restated                                              | 5/5             | 5/5           | 5/5       |
| `learning`     | expect rule: Tam Rook is a new character                                                                         | 5/5             | 5/5           | 5/5       |
| `learning`     | avoid rule: Tam Rook, who fled, is not made dead                                                                 | 5/5             | 5/5           | 5/5       |
| `learning`     | avoid rule: no description tells Tam as dead                                                                     | 2/5             | 2/5           | 1/5       |
| `learning`     | expect rule: the steward, who is after the shop, is a new character                                              | 5/5             | 4/5           | 2/5       |
| `learning`     | expect rule: Tam’s aunt, whom Oriel sets out to find, is a new character                                         | 2/5             | 0/5           | 1/5       |
| `learning`     | avoid judgment: a steward, if added, is described by what he is doing                                            | 4/5             | 4/5           | 5/5       |
| `learning`     | expect rule: finding Tam is a new thread                                                                         | 5/5             | 5/5           | 5/5       |
| `learning`     | avoid rule: the unrelated listed fire gets no awareness                                                          | 5/5             | 5/5           | 5/5       |
| `learning`     | avoid rule: knownAwareness names only a listed happening                                                         | 5/5             | 5/5           | 5/5       |
| `learning`     | avoid rule: every ID names a listed row or a handle the reply declares                                           | 5/5             | 5/5           | 5/5       |
| `learning`     | avoid rule: happening descriptions in the third person                                                           | 5/5             | 5/5           | 5/5       |
| `namedrops`    | parsed                                                                                                           | 5/5             | 5/5           | 5/5       |
| `namedrops`    | expect rule: Jorun Vask, whom Wren sets out to find, is a new character                                          | 5/5             | 5/5           | 5/5       |
| `namedrops`    | avoid judgment: no new character for a name only invoked: a saint in an oath, a king in a saying, a song’s maker | 5/5             | 5/5           | 4/5       |
| `namedrops`    | avoid judgment: the fiddler, a passing figure, is not a new character                                            | 5/5             | 5/5           | 5/5       |
| `namedrops`    | avoid rule: the Copper Bell, a named place, is no character                                                      | 5/5             | 5/5           | 5/5       |
| `namedrops`    | avoid rule: knownAwareness names only a listed happening                                                         | 5/5             | 5/5           | 5/5       |
| `namedrops`    | avoid rule: every ID names a listed row or a handle the reply declares                                           | 5/5             | 4/5           | 5/5       |
| `namedrops`    | avoid rule: happening descriptions in the third person                                                           | 5/5             | 5/5           | 5/5       |
| `direction`    | parsed                                                                                                           | 5/5             | 5/5           | 5/5       |
| `direction`    | avoid rule: no happening says Aria lied, which only the direction asked for                                      | 3/5             | 5/5           | 4/5       |
| `direction`    | expect rule: the confrontation tells what the narration made of it: she wrote it to their mother                 | 5/5             | 5/5           | 5/5       |
| `direction`    | expect rule: the burning, from the turn written as prose, is recorded                                            | 4/5             | 5/5           | 5/5       |
| `direction`    | expect rule: Kael knows of the confrontation                                                                     | 5/5             | 5/5           | 5/5       |
| `direction`    | avoid rule: knownAwareness names only a listed happening                                                         | 5/5             | 5/5           | 5/5       |
| `direction`    | avoid rule: every ID names a listed row or a handle the reply declares                                           | 5/5             | 5/5           | 5/5       |
| `direction`    | avoid rule: happening descriptions in the third person                                                           | 5/5             | 5/5           | 5/5       |
| `switch`       | parsed                                                                                                           | 5/5             | 5/5           | 5/5       |
| `switch`       | expect rule: the archive break-in is Wenna’s: a happening telling it involves her or gives her awareness         | 0/5             | 5/5           | 5/5       |
| `switch`       | avoid rule: the archive break-in is not credited to Dace, the lead after it                                      | 0/5             | 5/5           | 5/5       |
| `switch`       | expect rule: the ring paid for passage is Dace’s: a happening telling it involves him or gives him awareness     | 5/5             | 5/5           | 5/5       |
| `switch`       | avoid rule: the ring paid for passage is not credited to Wenna                                                   | 5/5             | 5/5           | 5/5       |
| `switch`       | avoid rule: knownAwareness names only a listed happening                                                         | 5/5             | 5/5           | 5/5       |
| `switch`       | avoid rule: every ID names a listed row or a handle the reply declares                                           | 5/5             | 5/5           | 5/5       |
| `switch`       | avoid rule: happening descriptions in the third person                                                           | 5/5             | 5/5           | 5/5       |
| all windows    | rule checks held                                                                                                 | 360/390         | 369/390       | 365/390   |
| all windows    | judgment checks held                                                                                             | 33/35           | 32/35         | 33/35     |
| evaluation set | first-attempt parse                                                                                              | 39/40           | 40/40         | 40/40     |
| parse probe    | first-attempt parse                                                                                              | 19/20           | 19/20         | 20/20     |
| close probe    | bar                                                                                                              | 7 of 10, missed | 8 of 10, met  | not rerun |
| close probe    | summaries in the first or second person                                                                          | 8 of 8          | 0 of 10       | not rerun |

The first wording's six falls are listed under Falls below; C1 moved
two more checks down, `learning` Tam as dead 2/5 → 1/5 and `namedrops`
the saint check 5/5 → 4/5. The `switch` window's other five checks are
5/5 in all three runs, and the third-person check is 5/5 in every
window before and after, so it had no headroom. The parse probe did not
rerun after E2, which moves a sentence within the bullet. In the close
probe, a cap was reached in 8 runs before and 9 after, and
`merge_threads` was called in 8 runs before and 10 after. Before, runs 7
and 8 ended in the metadata phase on a reply that never stopped (cause
unknown, 39,642 output tokens): those two alone made the bar missed. The
8 completed summaries before used the second person in four runs and the
first in four; none after.

The four windows with a falling check ran five more runs a side: before
and the first wording under Q21, C1 under Q23. So these are 10 runs:

| Window           | Check                                                                                                            | Before  | First wording | C1      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ------- | ------------- | ------- |
| `ambush`         | parsed                                                                                                           | 10/10   | 10/10         | 10/10   |
| `ambush`         | expect rule: Dov Hask is a new character                                                                         | 10/10   | 10/10         | 10/10   |
| `ambush`         | expect rule: the fight is one happening, not one a beat                                                          | 9/10    | 8/10          | 9/10    |
| `ambush`         | expect rule: a happening tells the fight’s moments: Hask unhorsed, the archer shot, Sefa’s wound                 | 10/10   | 10/10         | 10/10   |
| `ambush`         | expect rule: a happening sits at t4, the fight’s last turn                                                       | 10/10   | 10/10         | 10/10   |
| `ambush`         | expect rule: a happening involves Tobin, the prose’s "you"                                                       | 10/10   | 10/10         | 10/10   |
| `ambush`         | avoid rule: Pell, never in the prose, is involved in no happening                                                | 10/10   | 10/10         | 10/10   |
| `ambush`         | avoid rule: no happening’s description tells Pell in the fight                                                   | 10/10   | 10/10         | 10/10   |
| `ambush`         | expect rule: a happening involves Sefa                                                                           | 10/10   | 10/10         | 10/10   |
| `ambush`         | expect rule: a happening involves the crossing, where it happened                                                | 10/10   | 10/10         | 10/10   |
| `ambush`         | avoid rule: Sefa, wounded, is not retired                                                                        | 10/10   | 10/10         | 10/10   |
| `ambush`         | avoid rule: no new character stands for "you"                                                                    | 10/10   | 10/10         | 10/10   |
| `ambush`         | avoid judgment: the archer and the third rider, never named, are not new characters                              | 9/10    | 6/10          | 8/10    |
| `ambush`         | avoid rule: knownAwareness names only a listed happening                                                         | 10/10   | 10/10         | 10/10   |
| `ambush`         | avoid rule: every ID names a listed row or a handle the reply declares                                           | 10/10   | 10/10         | 10/10   |
| `ambush`         | avoid rule: happening descriptions in the third person                                                           | 10/10   | 10/10         | 10/10   |
| `recounted`      | parsed                                                                                                           | 10/10   | 10/10         | 10/10   |
| `recounted`      | expect rule: the wreck is a recounted happening, with its time                                                   | 10/10   | 10/10         | 10/10   |
| `recounted`      | expect rule: Nessa learns of the wreck, with learnedAtTurn                                                       | 10/10   | 10/10         | 10/10   |
| `recounted`      | expect rule: Brannoc, who watched it, is aware of the wreck                                                      | 10/10   | 10/10         | 10/10   |
| `recounted`      | expect rule: Edric Vane is a new character                                                                       | 10/10   | 10/10         | 10/10   |
| `recounted`      | expect rule: Vane, who gave the order, is involved in the wreck                                                  | 6/10    | 3/10          | 4/10    |
| `recounted`      | expect rule: Nessa’s resolve to take the page to court is a new thread                                           | 10/10   | 10/10         | 10/10   |
| `recounted`      | avoid rule: the wreck is one happening: the doused lamp is a moment of it, not its own                           | 10/10   | 10/10         | 10/10   |
| `recounted`      | avoid rule: knownAwareness names only a listed happening                                                         | 10/10   | 10/10         | 10/10   |
| `recounted`      | avoid rule: every ID names a listed row or a handle the reply declares                                           | 10/10   | 10/10         | 10/10   |
| `recounted`      | avoid rule: happening descriptions in the third person                                                           | 10/10   | 10/10         | 10/10   |
| `learning`       | parsed                                                                                                           | 10/10   | 10/10         | 10/10   |
| `learning`       | expect rule: Idris learns of the listed poisoning                                                                | 10/10   | 10/10         | 10/10   |
| `learning`       | expect rule: Oriel, who tells of the poisoning, knows of it                                                      | 5/10    | 5/10          | 6/10    |
| `learning`       | expect rule: his learning sits at t2                                                                             | 10/10   | 10/10         | 10/10   |
| `learning`       | avoid rule: the poisoning is not added again                                                                     | 10/10   | 8/10          | 8/10    |
| `learning`       | avoid rule: the listed master and apprentice views are not restated                                              | 10/10   | 10/10         | 10/10   |
| `learning`       | expect rule: Tam Rook is a new character                                                                         | 10/10   | 10/10         | 10/10   |
| `learning`       | avoid rule: Tam Rook, who fled, is not made dead                                                                 | 10/10   | 10/10         | 10/10   |
| `learning`       | avoid rule: no description tells Tam as dead                                                                     | 6/10    | 5/10          | 3/10    |
| `learning`       | expect rule: the steward, who is after the shop, is a new character                                              | 8/10    | 6/10          | 4/10    |
| `learning`       | expect rule: Tam’s aunt, whom Oriel sets out to find, is a new character                                         | 4/10    | 2/10          | 3/10    |
| `learning`       | avoid judgment: a steward, if added, is described by what he is doing                                            | 8/10    | 9/10          | 9/10    |
| `learning`       | expect rule: finding Tam is a new thread                                                                         | 10/10   | 10/10         | 10/10   |
| `learning`       | avoid rule: the unrelated listed fire gets no awareness                                                          | 10/10   | 10/10         | 10/10   |
| `learning`       | avoid rule: knownAwareness names only a listed happening                                                         | 10/10   | 10/10         | 10/10   |
| `learning`       | avoid rule: every ID names a listed row or a handle the reply declares                                           | 9/10    | 10/10         | 10/10   |
| `learning`       | avoid rule: happening descriptions in the third person                                                           | 10/10   | 10/10         | 10/10   |
| `namedrops`      | parsed                                                                                                           | 10/10   | 10/10         | 10/10   |
| `namedrops`      | expect rule: Jorun Vask, whom Wren sets out to find, is a new character                                          | 10/10   | 10/10         | 10/10   |
| `namedrops`      | avoid judgment: no new character for a name only invoked: a saint in an oath, a king in a saying, a song’s maker | 10/10   | 10/10         | 9/10    |
| `namedrops`      | avoid judgment: the fiddler, a passing figure, is not a new character                                            | 10/10   | 10/10         | 10/10   |
| `namedrops`      | avoid rule: the Copper Bell, a named place, is no character                                                      | 10/10   | 10/10         | 10/10   |
| `namedrops`      | avoid rule: knownAwareness names only a listed happening                                                         | 10/10   | 10/10         | 10/10   |
| `namedrops`      | avoid rule: every ID names a listed row or a handle the reply declares                                           | 10/10   | 9/10          | 10/10   |
| `namedrops`      | avoid rule: happening descriptions in the third person                                                           | 10/10   | 10/10         | 10/10   |
| the four windows | rule checks held                                                                                                 | 417/440 | 406/440       | 407/440 |
| the four windows | judgment checks held                                                                                             | 37/40   | 35/40         | 36/40   |

The classifier's final wording, E2, ran `learning` and `recounted` at 20
runs, against the before runs' 20 (the first, second and third sets of
each) and C1's 20, every check; the p-values are two-sided Fisher exact
tests against before, the test fixed under Q27. The four checks that
failed the earlier rules are the poisoning, Tam as dead, the steward
and Vane.

| Window      | Check                                                                                  | Before, 20 runs | C1, 20 | E2, 20 | p, before vs C1 | p, before vs E2 |
| ----------- | -------------------------------------------------------------------------------------- | --------------- | ------ | ------ | --------------- | --------------- |
| `learning`  | parsed                                                                                 | 20/20           | 20/20  | 20/20  |                 |                 |
| `learning`  | expect rule: Idris learns of the listed poisoning                                      | 19/20           | 19/20  | 20/20  | 1.000           | 1.000           |
| `learning`  | expect rule: Oriel, who tells of the poisoning, knows of it                            | 10/20           | 12/20  | 9/20   | 0.751           | 1.000           |
| `learning`  | expect rule: his learning sits at t2                                                   | 19/20           | 19/20  | 20/20  | 1.000           | 1.000           |
| `learning`  | avoid rule: the poisoning is not added again                                           | 19/20           | 14/20  | 19/20  | 0.091           | 1.000           |
| `learning`  | avoid rule: the listed master and apprentice views are not restated                    | 20/20           | 20/20  | 20/20  | 1.000           | 1.000           |
| `learning`  | expect rule: Tam Rook is a new character                                               | 20/20           | 20/20  | 20/20  | 1.000           | 1.000           |
| `learning`  | avoid rule: Tam Rook, who fled, is not made dead                                       | 20/20           | 20/20  | 19/20  | 1.000           | 1.000           |
| `learning`  | avoid rule: no description tells Tam as dead                                           | 11/20           | 5/20   | 8/20   | 0.105           | 0.527           |
| `learning`  | expect rule: the steward, who is after the shop, is a new character                    | 13/20           | 10/20  | 10/20  | 0.523           | 0.523           |
| `learning`  | expect rule: Tam’s aunt, whom Oriel sets out to find, is a new character               | 7/20            | 7/20   | 6/20   | 1.000           | 1.000           |
| `learning`  | avoid judgment: a steward, if added, is described by what he is doing                  | 18/20           | 19/20  | 19/20  | 1.000           | 1.000           |
| `learning`  | expect rule: finding Tam is a new thread                                               | 20/20           | 20/20  | 20/20  | 1.000           | 1.000           |
| `learning`  | avoid rule: the unrelated listed fire gets no awareness                                | 20/20           | 20/20  | 20/20  | 1.000           | 1.000           |
| `learning`  | avoid rule: knownAwareness names only a listed happening                               | 20/20           | 20/20  | 20/20  | 1.000           | 1.000           |
| `learning`  | avoid rule: every ID names a listed row or a handle the reply declares                 | 19/20           | 20/20  | 19/20  | 1.000           | 1.000           |
| `learning`  | avoid rule: happening descriptions in the third person                                 | 20/20           | 20/20  | 20/20  | 1.000           | 1.000           |
| `recounted` | parsed                                                                                 | 20/20           | 20/20  | 20/20  |                 |                 |
| `recounted` | expect rule: the wreck is a recounted happening, with its time                         | 20/20           | 20/20  | 20/20  | 1.000           | 1.000           |
| `recounted` | expect rule: Nessa learns of the wreck, with learnedAtTurn                             | 17/20           | 20/20  | 17/20  | 0.231           | 1.000           |
| `recounted` | expect rule: Brannoc, who watched it, is aware of the wreck                            | 18/20           | 20/20  | 19/20  | 0.487           | 1.000           |
| `recounted` | expect rule: Edric Vane is a new character                                             | 19/20           | 20/20  | 18/20  | 1.000           | 1.000           |
| `recounted` | expect rule: Vane, who gave the order, is involved in the wreck                        | 6/20            | 11/20  | 6/20   | 0.200           | 1.000           |
| `recounted` | expect rule: Nessa’s resolve to take the page to court is a new thread                 | 20/20           | 20/20  | 20/20  | 1.000           | 1.000           |
| `recounted` | avoid rule: the wreck is one happening: the doused lamp is a moment of it, not its own | 20/20           | 20/20  | 20/20  | 1.000           | 1.000           |
| `recounted` | avoid rule: knownAwareness names only a listed happening                               | 20/20           | 20/20  | 19/20  | 1.000           | 1.000           |
| `recounted` | avoid rule: every ID names a listed row or a handle the reply declares                 | 20/20           | 20/20  | 20/20  | 1.000           | 1.000           |
| `recounted` | avoid rule: happening descriptions in the third person                                 | 20/20           | 20/20  | 20/20  | 1.000           | 1.000           |

Over these two windows E2 holds 429/500 rule checks and 19/20 judgment
checks, before 437/500 and 18/20. E2 ran only these two windows: the other six windows
and the parse probe were not rerun under E2; C1's figures stand in for
them, the same words with the sentence earlier in the bullet. The
close's are unaffected, its rule being untouched.

**Falls.** The first wording's six falls at 5 runs are in the table:
`ambush` "the archer and the third rider, never named, are not new
characters" 4/5 → 3/5, `recounted` "Vane, who gave the order, is
involved in the wreck" 4/5 → 2/5, `learning` "the poisoning is not
added again" 5/5 → 3/5, `learning` "the steward, who is after the shop,
is a new character" 5/5 → 4/5, `learning` "Tam's aunt, whom Oriel sets
out to find, is a new character" 2/5 → 0/5 and `namedrops` "every ID
names a listed row or a handle the reply declares" 5/5 → 4/5, with
judgment checks held 33/35 → 32/35. Raised with the developer, who
ruled in the order above (Q21, Q23, Q27, Q29). Under the shipped E2,
five `learning` checks and two `recounted` checks sit one to three runs
below their before count (the steward 13/20 → 10/20 and Tam as dead
11/20 → 8/20 the largest), none at p below 0.5. That is the known cost of the sentence; the figures don't
separate it from sampling.

**Not probed.** The close's marks and the narrator's reading of marks
met no real model: no probe reaches the narrator (Q2), and the close
probe runs the dataset seed, which has no switch (Q6). The `switch`
window is the slice's one real-model check on marks, and it ran under
the first wording and C1 only, not E2. The dataset
chapter fits one call at the dev model's window, so the part and merge
calls' summary rule met no real model either.
