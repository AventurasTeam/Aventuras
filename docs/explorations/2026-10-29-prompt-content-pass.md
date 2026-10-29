# The prompt content pass

What each prompt carries once every story input reaches the prompts
that should carry it: the narrator's standing instructions, who knows
what, the user's voice in suggestions, who wrote each turn, and the
wizard's last two calls. Designed 2026-10-29; resolves the design half
of the followup "Prompt content pass" and leaves its implementation as
a new followup.

## Why

The system and user halves moved the prompts into a new shape without
rewriting them. The narrator's standing instructions are one
output-format line: no template renders the narration person, and none
says who the lead is or what the mode means. The pass is done when
every story and settings input the user sets reaches the prompts that
should carry it.

## Ground truth that shaped it

- **Canon promised a POV bound nothing delivered.** Retrieval gives the
  narrator the happenings any in-scene character knows, and
  `retrieval.md → POV-awareness scope` bounded the leak by
  "narration-mediated prompting". No template rendered narration, and a
  happening row printed each awareness row's `source` without the
  character's name (`lib/retrieval/run.ts`), so no wording could tell
  the narrator who knows what.
- **The gap reached past the narrator.** Reads at design time:
  - the narrator read neither mode, lead nor narration;
  - the wizard opening read the mode and the lead's id, not narration;
  - both suggestion prompts read none of the three, nor the wrap
    person, though a chip is sent as the user's own turn and the
    adventure category hints say "the lead";
  - the periodic classifier had a lead line, the fallback none;
  - the title and description calls read the opening alone, where
    `wizard.md` says they see everything.
- **The narrator never saw the story's time.** Canon's v2 context table
  names a `timeTracker`; no context built it and no template rendered
  it.
- **Nothing marks who wrote a turn.** Every history renders
  `entry.content` alone; a turn's `kind` exists but no template reads
  it.
- **Placeholders are allocated per call**, in the order the context
  object is walked (`lib/ids/substitute.ts`), so a lead's bracketed id
  can differ from one call to the next.
- **`stories.description` is never sent.** `data-model.md` keeps it as
  the user's own blurb and notes; `definition.setting` is the world,
  time and place, already in the narrator's system half.

## Decisions

**Omniscient narration; characters know what they know.** A character
speaks, acts and remembers only from what they know; the narration may
tell what no one in the scene knows. A limited narrator is a future
prompt variant, parked.

**First person keeps to the lead.** The narrator is the lead there, so
an omniscient "I" breaks the rule for the one character the story is
about. Rejected: _omniscient in every person_, a retrospective "I" that
a model would mostly write as leakage.

**Happening rows name who knows them.** One line names each in-scene
knower with how they know; a common-knowledge happening says so. The
lead always counts toward the scope in adventure and first or second
person, so a missed scene tag can't wipe what the lead knows.

**Adventure: a turn is the lead's attempt.** The narrator plays it out
and decides the world's response, failure included; it may give the
lead perceptions, sensations and involuntary reactions, never a choice,
a line of speech or an action the user didn't write; it stops at the
lead's next choice. Text that plainly addresses the narrator is
followed as a direction. Rejected: _nothing beyond the user's turn_,
which first person can't keep since its narration is the lead's inner
voice; _no restriction_, which breaks the promise that the user is the
character.

**Creative: direction or prose.** The narrator follows a turn that
reads as a direction and continues one that reads as prose. Rejected:
_prose only_, which turns an instruction into story text; _directions
only_, which users won't keep to.

**Chips speak as the user.** Adventure chips are the lead's next turn
in the wrap person, falling back to first person when the lead is
missing; creative chips are short directions in third person by name.
The voice sits in the tagged and the JSON emission macros, so all
three paths that write chips carry it, the fallback classifier's fold
included. Wrap POV is the person the user's input is written in, and a
chip is offered input, so the field stays editable while suggestions
are on and is disabled only when modes and suggestions are both off,
or in creative.

**Who wrote a turn shows in every history.** Creative's directions
made it necessary: a classifier reading "Kael confronts Aria; she lies"
records it as happened, and a narrator reading an old direction in its
history copies it. Adventure gains it too: "I pick the lock." reads as
done before the reply decides.

**Shared macros take their inputs as parameters.** One macro holds the
standing instructions for the narrator and the opening, one the chip
voice for both suggestion prompts; reading only their parameters makes
them `staticContent`. Rejected: _instructions inline per template_,
which drift apart; _instruction text built in code_, which breaks
formatting-in-Liquid and takes the wording from pack authors. Happening
rows stay built in code, since that string is what the ranker measures.

**The lead's name sits in the system half.** A rename moves the prefix
once, rare enough. Rejected: _the name in the user half_, which
separates the rule from its subject. Names only: a bracketed id there
would move it every call.

**Placement questions go to tuning.** Splitting the wizard's shared
macros into contract and grounding, and moving the user-half blocks
that point at content "above", change where an instruction reads, not
what reaches a prompt. Moving the state block would cache about 1.5k
tokens a turn but takes a format directive from the end of the prompt,
where models follow it best.

**The wizard's earlier calls keep their subsets.** Canon described
every call as seeing all wizard state; the templates pick what bears
on each field, and canon now lists those reads. Title and description
read genre and tone by label: a body is instructions to a model, not a
fact about the story.

## The design

Canonical in:

- [`principles.md → Mode, lead, and narration`](../ui/principles.md#mode-lead-and-narration--three-orthogonal-concepts):
  the attempt rule, directions in both modes, the knowledge rule;
- [`principles.md → Composer mode`](../ui/principles.md#composer-mode--send-time-transform-narration-aware):
  the wrap person sets the chips' voice;
- [`architecture.md → System and user halves`](../architecture.md#system-and-user-halves):
  each template's halves, the stability amendment;
- [`memory/retrieval.md → POV-awareness scope`](../memory/retrieval.md#pov-awareness-scope):
  the row's knowers, the lead in the scope;
- [`memory/classifier.md → What the classifier reads`](../memory/classifier.md#what-the-classifier-reads)
  and
  [`memory/piggyback.md → Fallback classifier context`](../memory/piggyback.md#fallback-classifier-context):
  the turn's author and the mode rule;
- [`reader-composer.md → Next-turn suggestions`](../ui/screens/reader-composer/reader-composer.md#next-turn-suggestions):
  the chips' voice;
- [`wizard.md → Context-shaping`](../ui/screens/wizard/wizard.md#context-shaping):
  what each wizard call reads.

## Adversarial pass

- **Load-bearing**: that models follow the attempt rule, the knowledge
  rule and the chip voice. Unverified; play checks them, and the
  classifier's evaluation set is re-run on the dev model, the floor its
  prompt is tuned to.
- **Placeholder ids**: verified per call, so system halves name the
  lead and the fallback's id-bearing lead line sits in its user half.
- **Out of character in adventure**: found here; the direction escape
  hatch above.
- **Accepted**: a window spanning a lead switch reads the old lead's
  "I" as the new lead's, as the periodic classifier already does; two
  in-scene namesakes can't be told apart on a row; a missing lead in
  first person falls back to omniscient narration; a calendar that
  fails to render leaves the time block out rather than print a raw
  number.
- **Read sites**: the variable registry and its parity tests (`lead`,
  `currentTime`, the wizard's start time), the system-half stability
  test, the memory-blocks tests, template snapshots, the classifier
  probe and evaluation set.
- **Stored data untouched**: the author is the existing `kind`, the
  lead `definition`, the knowers awareness rows, the time entry
  metadata. No migration; forks, deltas, reversals and backups are
  unaffected. Prompts stay in the source language.

## Integration plan

- `ui/principles.md → Mode, lead, and narration`: Adventure gains the
  attempt rule and the direction escape hatch, and its stale "filters
  prompt context by the lead's awareness links" points at the union
  scope instead; Creative gains direction or prose; Narration gains the
  knowledge rule.
- `ui/principles.md → Composer mode`: the wrap person sets adventure
  chips' voice.
- `architecture.md → System and user halves`: the stability rule gains
  the lead's rename and names-only; the template table's narrator,
  fallback, refresh and wizard rows. `→ v2 shape of generationContext`:
  `timeTracker` becomes `currentTime`. `→ POV-awareness — union`: the
  narration lever becomes the knowers line and the narrator's rule.
- `memory/retrieval.md → POV-awareness scope`: the lead joins the
  scope; the leak bound is the row's knowers and the narrator's rule;
  the row's text written down.
- `memory/classifier.md → What the classifier reads`: turns carry
  their author; the lead bullet gains the mode rule.
- `memory/piggyback.md → Fallback classifier context`: the lead line in
  its user half, the mode rule in its system half, the turns' author.
- `data-model.md → Story settings shape`: the dangling-lead paragraph's
  "no bundled generation template reads `leadEntityId`" becomes the
  context resolving `lead`; the `composerWrapPov` comment gains the
  chips' voice.
- `reader-composer.md`, Next-turn suggestions: the voice rule beside
  "Suggestions are complete prose", which becomes "finished turns".
- `story-settings.md`, Authoring aids: when wrap POV is disabled; the
  `composerWrapPov` confirmation copy, and its wireframe, name the
  chips' voice.
- `wizard.md`, the title and description section: the two calls'
  reads and the description's length; Context-shaping: the per-call
  reads list.
- `followups.md`: "Prompt content pass" replaced by "Implement the
  prompt content pass" (Data-model), the nits moved verbatim; "Prompt
  tuning" gains the two placement questions and the play checks.
- `parked.md → Parked until signal`: "A limited narrator in second and
  third person".
