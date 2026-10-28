# Measuring the classifier prompt

The record behind the followup "Classifier prompt: interface and
structure": the periodic classifier's prompt measured against a
hand-written evaluation set before any change to its structure, then
one measured change at a time. Started 2026-10-28.

## The evaluation set

Five windows in `scripts/classifier-eval/`, each a few turns of
hand-written prose over a small hand-written roster, built in memory
and rendered as the pass renders a branch. The parse probe sends them
with `PROBE_EVAL`
([`testing.md → Real-provider checks`](../testing.md#real-provider-checks)).

| Window    | What it exercises                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------- |
| ambush    | a fight across two turns, in second person; the lead named only by the scene, beside a silent drover      |
| recounted | an event thirty years before the story, told by a witness who hands over evidence                         |
| reveal    | a listed stranger gives her name, an epithet, then a cover name                                           |
| defection | a sergeant changes sides; an agent wears his old faction's coat as a disguise                             |
| learning  | a character learns of a listed happening; a listed relationship the prose restates; a fled boy, a steward |

Each check is marked `rule` when a rule in the prompt asks for the
fact and `judgment` when only the window's author does; every window
also checks that each ID a reply names is a listed row or a handle the
reply declares. The developer reviewed the windows on 2026-10-28. Left
unscored on purpose: whether the steward becomes a character, and
whether the page changing hands is a happening, since piggyback
records the item and who gave it.

## Baseline

Prompt and schema as merged in #669, at `8431f777a`, against the dev
model `Gemma4-26B-A4B-QAT-MTP` on the llama.cpp router, structured
output on auto, no temperature sent, 5 runs a window. The dev model is
the capability floor the prompt is tuned to.

### Parsing

18 of 25 runs parsed at the first attempt, 3 after a parse retry, and
4 failed after it. Every reply came wrapped in a `json` code fence,
which jsonrepair strips. Every reply that wasn't valid JSON under its
fence, 13 of the 32 calls, had the same slip: a key that lost its
closing quote.

| Form                                | Seen as             | Outcome                                        |
| ----------------------------------- | ------------------- | ---------------------------------------------- |
| the quote missing, the value quoted | `"ref: "c2",`       | parses: jsonrepair, then the key-colon restore |
| the quote after the value           | `"placements: []",` | the reply fails                                |
| no closing quote                    | `"severity: 0.5,`   | the reply fails                                |
| the value lost                      | `"name: ",`         | the reply fails                                |

A reply can carry several: 18 of the 2,142 keys written slipped
(0.8%). Nine runs on the prompt before #669's review slipped 12 of 797
keys (1.5%), all in the form that parses, so the drop from 9 of 9
first-attempt parses to 18 of 25 is which form came up, not the
review's wording.
Untested: whether the slip comes from the model, its QAT quant, MTP
decoding or the server's default sampling. A run took 61-229 s; a
parse retry about doubles it.

### Content

Scored over the 21 replies that parsed. Rule checks held 118 of 159,
judgment checks 30 of 42.

| Window    | Parsed | Held well                                      | Missed most                                                                                   |
| --------- | ------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ambush    | 3      | Sefa involved, not retired; no "you" character | one happening (0/3), the riders unnamed (1/3)                                                 |
| recounted | 4      | the new thread; the telling not a happening    | Brannoc aware (0/4), Vane involved (0/4), Vane a character (1/4), Nessa's learnedAtTurn (1/4) |
| reveal    | 5      | the rename, the Heron, no character for her    | the cover name Mistress Penn (0/5)                                                            |
| defection | 5      | membership at t2, no faction for the disguise  | invented IDs (2/5)                                                                            |
| learning  | 4      | Tam a character, the thread, no restated views | Tam made dead (3/4)                                                                           |

The failures that recur, by how many of the 21 replies show them:

- **`knownAwareness` for the reply's own happenings**, 10. The
  entries name a new happening by its title, by "h1", by an invented
  "hp_marigold_shipwreck", once by turn handles. The list exists for
  a happening Known happenings lists; the rule that says so comes
  fourth, the list is written last.
- **A happening per beat**, every ambush and reveal reply: 5 to 8
  happenings for the fight, 2 or 3 for the reveal (cornering her, her
  name, the note).
- **Invented IDs**, 5: threads named by title in `threadStatuses`, a
  placeholder written with its brackets (`[c1]`), an object as an
  involvement.
- **The recounted wreck's people.** The Count went into newFactions
  twice ("the Vane family", "House Vane") and newCharacters once;
  Brannoc, who watched it, is never in its awareness.
- **Tam Rook made dead**, 3 of 4 learning replies, against "never
  invent".
- **The lead.** One ambush reply made Pell, the silent drover listed
  first, the actor of Tobin's charge, and left Tobin out of all six
  happenings.
- **Unnamed riders as new characters**, 2 of 3 ambush replies, once
  with empty names.
- **A change of sides as a join, then a leave**, 1 of 5 defection
  replies, which the planner turns into no faction.

Two checks were corrected after reading these replies: "X's death"
forms of Tam's death and of a re-added poisoning had scored as held.

## Recovering the slip

The developer prefers the reply format in the prompt to a provider's
structured output, so the slip is recovered in code rather than ruled
out by a grammar. `parseStructured` now gives a key its quote back on
a line that opens on a key the schema declares, before jsonrepair, and
drops a colon left inside a key's quotes (`"role:": "target"`, a form
first seen in this corpus) on strict JSON too
([`tech-stack.md → jsonrepair`](../tech-stack.md#7-jsonrepair)).
Replayed through it, all 41 saved calls of both runs parse at their
first call and the 25 clean ones come out unchanged. Read as the app
would now read them, the baseline's 25 runs hold 140 of 190 rule
checks and 33 of 55 judgment checks: the reference the changes below
compare against.

## Temperature 0.7

The router samples this model at temperature 1.0, top_p 0.95 and
top_k 20. Rerun with the request setting 0.7, the set slipped 3 of
1,930 keys (0.16%), against 18 of 2,142 at 1.0: some 16 were due at
the old rate. All three were forms the recovery handles, and every
run's first call parses. The content didn't move: 141 of 190 rule
checks and 32 of 55 judgment checks, read the same way. So a lower
temperature makes the slip rarer and leaves what the model extracts
alone, at five runs a window.

Two things the run showed that the baseline didn't:

- **Unnamed characters written with a null name.** Two ambush replies
  gave the archer and the third rider `"name": null` or no
  description, and the reply's tolerant list dropped them, the outcome
  the window's check asks for, by accident. One of them did the same
  to Hask, whose name only comes at the fight's end, and lost him.
- **`temporal` on an event the prose only shows done.** "The ferry
  rope is cut" got "before the story". The developer read it as
  right: the prose shows the rope cut, not the cutting, which could
  have been half a day before the cart came, so the rule's offstage
  case applies. Only the phrase is loose, and it is the rule's own
  example for a past with no time.

## How a change is measured

A change either rewrites a rule's text where it stands, with its field
description if it has one, or moves and groups rules without changing
a sentence, which a script checks by comparing the rendered rules
before and after. One kind at a time, each measured on the whole set
against the replayed baseline at the router's temperature, the harsher
case, with the checks it should move named before the run. Five runs a
window shows only large shifts.

## Change 1: knownAwareness is for listed happenings

The Awareness rule told the model to set learnedAtTurn when a
character learns of a past event, then, for a listed happening, to add
a knownAwareness entry with learnedAtTurn, and never said where the
learners of a happening the reply adds go. The baseline's replies made
the wreck a new happening with an empty awareness and filed Nessa under
knownAwareness, naming it by title. The rule now ends: "knownAwareness
is for those listed happenings alone: who learns of a happening this
reply adds goes in that happening's own awareness, and when the turns
show no one learning of a listed happening, knownAwareness stays
empty", and the field's description says the same.

Expected to move: knownAwareness naming only listed happenings in
ambush, recounted and reveal, and Nessa's learnedAtTurn; at risk,
Idris learning of the listed poisoning.

| knownAwareness names only a listed happening | ambush | recounted | reveal | defection | learning |
| -------------------------------------------- | ------ | --------- | ------ | --------- | -------- |
| baseline                                     | 1/5    | 0/5       | 1/5    | 5/5       | 4/5      |
| change 1                                     | 4/5    | 3/5       | 2/5    | 4/5       | 4/5      |

Nessa's learnedAtTurn rose from 1 to 3 of 5; Brannoc stays unaware of
the wreck in all five. Idris learning of the poisoning held, 5 of 5.
Over the set, rule checks went from 140 to 158 of 190 and judgment
checks from 33 to 29 of 55, the fall a scatter of single runs. Kept.

Reveal is what's left: its replies still add "Ilse reveals her name"
with an empty awareness and file Corwin under knownAwareness as "h1"
or "t4", the new sentence notwithstanding. The rule sits fourth and the
list is written last; that is the structure pass's question.

The run slipped 1 of 1,640 keys, against 18 of 2,142 in the baseline
at the same temperature and a similar reply size, on a router the
developer left untouched, serving the same model throughout. Slips
cluster, one call held five and one on the earlier prompt ten, so
calls are the steadier count: a slip in 3 of 9 calls on the earlier
prompt, 13 of 32 in the baseline, 3 of 27 at 0.7 and 1 of 25 here.
The prompt change can't account for that, and the cause is open; the
probe now saves llama.cpp's timings with each reply, its draft
acceptance, prompt-cache reuse and speed, for the runs after this one
to be read against.

## Change 2: rules under the lists they govern

The system half's rules now sit under headings: "Rules for every
list:" over provenance, scene and silence, then one heading for each
reply list or group of lists, in the order the reply writes them, so
the Awareness rule's sentences on listed happenings, change 1's among
them, make a knownAwareness section of their own instead of ending the
fourth rule. No sentence changed: the script
found the same 95 sentences before and after (104 with mentioned
places on), the headings the only additions, and the user half
identical.

Expected to move: knownAwareness naming only listed happenings in
reveal and recounted; at risk, Idris learning of the listed poisoning.
Ten runs a window this time, since a regrouping could move many checks
a little. With the slip rate moving between runs on an unchanged
router, change 1's prompt was also run again, five a window from its
own commit, to tell a run's drift from the change's effect.

| knownAwareness names only a listed happening | ambush | recounted | reveal | defection | learning |
| -------------------------------------------- | ------ | --------- | ------ | --------- | -------- |
| change 1                                     | 4/5    | 3/5       | 2/5    | 4/5       | 4/5      |
| change 1, again                              | 4/5    | 3/5       | 4/5    | 4/5       | 5/5      |
| change 2                                     | 9/10   | 10/10     | 10/10  | 10/10     | 10/10    |

The rerun held change 1's scores, the mean rate of rule checks 0.85
against 0.83 and of judgment checks 0.53 both times, so between runs
of one prompt the content holds steady. Against it, knownAwareness
went from 37 of 50 to 49 of 50, Nessa's learnedAtTurn from 6 of 10 to
10 of 10, and Brannoc, unaware of the wreck in all ten runs of change
1's prompt, is aware in 3 of 10. Idris learning of the poisoning held,
10 of 10. Over the set the mean rate of rule checks is 0.86 and of
judgment checks 0.57. Kept.

Two failures read against both runs of change 1's prompt:

- A reply named its own new thread again in threadStatuses, by title
  and with the status newThreads already gives it, in 12 of 50 runs
  against 3 of 50, and in 5 of 25 in the baseline. It is every
  reference that resolves to nothing, and costs only a dropped entry
  repeating a status. The Threads rule now shares a
  heading with newThreads, and only its last sentence says thread
  takes a listed thread's ID.
- A reply sent happenings without a title, which the parser drops with
  their involvements and awareness, in 4 of 50 calls against 2 of 50;
  three were defection's, and two of them account for its toll-house
  check's failures and two of the ledger theft's. No rule asks for a
  title.

Tam Rook made dead in 5 of 10 runs, against 2 of 10, is the largest
other move, within what ten runs leave open.

The slips moved again with the prompt held still: change 1's prompt
slipped 1 of 1,640 keys the first time and 16 of 1,598 on the rerun, a
slip in 1 call of 25 and then 9, and the regrouped prompt 37 of 2,926,
in 17 calls of 50. In neither run do the calls with a slip differ from
the rest in draft acceptance (0.75 against 0.76, 0.75 against 0.75),
prompt-cache reuse or speed. So the swing is neither the prompt nor
anything llama.cpp's timings show, and it left the content scores
alone. Every reply parsed.

## Scoring blank names

The ambush check against the unnamed archer and third rider, and
defection's against a new character, counted every newCharacters
entry, blank names among them, though the planner creates nothing for
a blank name. Under headings the extras came back with blank names, so
the checks failed replies the app would have read correctly. They now
count only named entries, and every run so far was scored again from
its raw replies: the mean rate of judgment checks reads 0.64 at
baseline, 0.60 and 0.58 for change 1's prompt and 0.66 for change 2's,
in place of the figures above; the rule checks' are unchanged. The
ambush check reads 2 of 5, 3 of 5, 3 of 5 and 10 of 10.

## Change 3: threadStatuses for listed threads

The Threads rule's last sentence now goes on: "threadStatuses is for
those listed threads alone: a thread this reply adds carries its
status in its own newThreads entry and never appears in
threadStatuses", and the thread field's description says the same.

Expected to move: a reply's own new thread named in threadStatuses, 12
of 50 runs on change 2's prompt, and with it every reference resolving
in recounted, reveal, defection and learning; at risk, the new threads
for finding Tam and for Nessa's resolve, and knownAwareness, whose
sentence this one follows in form.

| every ID names a listed row or a handle the reply declares | ambush | recounted | reveal | defection | learning |
| ---------------------------------------------------------- | ------ | --------- | ------ | --------- | -------- |
| change 2                                                   | 10/10  | 8/10      | 9/10   | 5/10      | 6/10     |
| change 3                                                   | 10/10  | 8/10      | 9/10   | 10/10     | 10/10    |

No reply named its own thread in threadStatuses, against 12 of 50. The
three references still unresolved are of other kinds: names written as
involvement refs, turn handles as awareness refs, and IDs written with
their brackets. Both new threads held at 10 of 10 and knownAwareness at
49 of 50. The mean rate of rule checks is 0.87 against 0.86, of
judgment checks 0.65 against 0.66. Kept.

The ambush extras came back named in 4 of 10 replies ("the archer",
"the third rider"), against none on change 2's prompt, which this
change doesn't touch; change 2's 10 of 10 was its good end. Happenings
without a title were dropped in 5 of 50 calls, against 4 and 2: one
ambush reply sent all eight without one and lost the fight, Sefa and
the crossing with them. The slip rate was 34 of 3,030 keys, in 14 of
51 calls, every reply parsed.

## Change 4: a change of sides is one membership

Half the defection replies on changes 2 and 3 gave Brann two
memberships at the turn he swears, House Varro and none, and when the
none came last the planner, applying a turn's facts in reply order,
left him in no faction: 6 of 20 runs. Nothing said a change of sides
needs no none first. The Memberships rule now goes on after "Set it to
none when they leave it or are cast out": "A change of sides is one
fact naming the new faction: no fact sets none for the faction they
leave", and the faction field's description says the same.

Expected to move: Brann ending in House Varro, 7 of 10 twice; at risk,
Maela's borrowed coat changing no membership and his membership
sitting at t2, both 10 of 10, and memberships appearing in windows
that have none.

A none beside the join came in 1 of 10 replies, against 10 of 20, and
it is the one run that leaves Brann in no faction: 9 of 10 against 7.
Maela's coat and the turn held at 10 of 10, and no other window wrote
a membership. The mean rate of rule checks is 0.89 against 0.87, of
judgment checks 0.63 against 0.65. Kept.

Happenings without a title were dropped in 4 of 50 calls again, 15
happenings this time: one ambush reply sent all eight without one and
another four. Tam Rook made dead swings between runs with no change
near it, 5, 4 and now 7 of 10.

## Change 5: every happening needs a title

No rule asked for a happening's title, which only the reply type marks
required, and replies sent happenings without one in 2, 4, 5 and 4 of
50 calls on the prompts so far; the parser drops each with its
involvements and awareness. A new rule now opens the happenings
section: "Titles. Give every happening a title, a few words naming the
event as a chapter heading would ("The duel at the mill"), and a
description of what happened, from the prose. A happening without a
title is dropped, with its involvements and awareness." The title
field's description says every happening needs one.

Expected to move: the calls that drop happenings, and with them
ambush's happening at t4, Sefa and the crossing, each 8 of 10 on
change 4's prompt, and defection's toll-house, 8 of 10; at risk, the
checks that count happenings, the telling that is no happening (9 of 10) and the poisoning not added again (10 of 10), and the example's
words turning up in titles.

No call dropped a happening, against 4 of 50, and the four checks read
10 of 10. The telling and the poisoning held at 10 of 10, and no title
borrowed the example's words. Replies average the same number of
happenings, 2.4 against 2.5, but now describe 110 of 122 against 41 of
125, at about 3% more completion tokens, nearly all of it reasoning.
The mean rate of rule checks is 0.91 against 0.89, of judgment checks
0.65 against 0.63. Kept.

## Change 6: a bar for new characters

Factions and places each had a bar, characters none: the rule took
every character the prose introduces, and the ambush replies added the
unnamed archer and third rider by a name in 3 or 4 runs of 10, which
the developer's review of the windows marked as noise. The New
characters rule now opens: "Add a character the prose introduces who
is not in the Known entities list: a named one, or an unnamed one the
story could come back to ("the innkeeper who hid them"). Not a passing
figure there only for the moment ("a porter", "a soldier in the
crowd")." The name field gets no description: telling the model how
to name an unnamed character could turn the blank-named extras, which
the planner drops, into created ones. Canon's write list gains the
bar.

Expected to move: the riders, 7 of 10 twice; holding, Dov Hask, named
only at the fight's end, Tam Rook, no character for "you", defection's
extras and the fishmonger; either way, Vane, named, at 2 of 10, and
the steward, unnamed and left unscored, added in 1 of 10.

| replies adding    | a named rider | the steward | Tam's aunt | Vane | Vane's son |
| ----------------- | ------------- | ----------- | ---------- | ---- | ---------- |
| change 5's prompt | 3             | 1           | 0          | 2    | 1          |
| change 6's prompt | 0             | 6           | 2          | 2    | 1          |

The riders check reads 10 of 10, and every check expected to hold did
but Dov Hask, 9 of 10: one reply added the scarred man with a blank
name and renamed its own handle at t4, a rename the planner resolves
only against listed rows, the path one reply on change 3's prompt took
too. The model still writes blank-named riders, 11 against 15, which the
planner drops.
Vane didn't move. The learning window gained characters: the steward,
who is hunting the alchemists in the prose, in 6 of 10, and Tam's
aunt, where Oriel will start looking, in 2, both ones a story could
come back to. The mean rate of rule checks is 0.89 against 0.91, the
two Nessa misses being IDs written with their brackets, of judgment
checks 0.69 against 0.65. Kept, with the steward for the developer to
judge.

## Change 7: awareness counts who witnessed it

The Awareness rule opened "List only characters the prose shows
learning the fact", against its own example source, "witnessed
firsthand", and the data model's awareness, a character who knows the
happening
([`data-model.md → Diagram`](../data-model.md#diagram)).
Brannoc, who watched the wreck he recounts, never learns it in the
turns, and no reply on changes 3 to 6 put him in its awareness. The
rule now opens: "List only characters the prose shows knowing the
fact: who witnessed it, and who learns of it."

Expected to move: Brannoc aware of the wreck, 0 of 10 four times; at
risk, the unrelated listed fire getting no awareness, knownAwareness
naming only listed happenings, Nessa's learnedAtTurn and Idris's
learning, and awareness spreading to everyone in a scene.

Brannoc is aware in 9 of 10. The fire, knownAwareness and Nessa held;
one learning reply added the listed poisoning again, with Oriel as its
teller, and so missed Idris's learning, as one reply on change 2's
prompt had. Awareness rows rose from 0.7 and 0.5 a happening to 1.3,
nearly all of it in recounted and defection, where those who did a
thing are now aware of it: Brann and Maela of the theft they carried
out. The silent drover Pell, whom replies take for the "you" of the
ambush, is aware in 23 of its happenings against 18 and 13, the lead
question again. Completion tokens didn't move. The mean rate of rule
checks is 0.90 against 0.89, of judgment checks 0.74 against 0.69.
Kept, until the run below.

This run also corrects change 6's reading. With the bar unchanged, 3
of 10 replies named a rider, so the bar's prompt names one in 3 of 20
runs against 10 of 30 before it, a smaller effect than change 6's run
alone showed. The steward came in 5 of 10 again, 11 of 20 against 7
of 30 before the bar, and Tam's aunt in 1.

Run again with the prompt unchanged, ten a window, Brannoc held at 7
of 10. Idris learning of the listed poisoning, which had held in every
run since change 2, missed in 3 of 10, 4 of 20 with the first run: two
of the misses added the poisoning again, and one wrote no
knownAwareness at all, reasoning that it had no new happening to
learn of. None of the reasoning cites the changed sentence, so the
learning window ran ten more times on change 6's prompt the same
afternoon: 10 of 10, 20 of 20 with its first run. A rule check and a
duplicated happening outweigh a judgment check: reverted.

The kept prompt, changes 1 to 6, then ran the whole set again. Idris
missed his learning once there too, a reply adding the poisoning
again, so the prompts without change 7 miss it in 1 of 70 runs since
change 2 against 4 of 20 with it: still a cost, less sure than the
first comparison read. Across the four runs with the bar, a reply
names a rider in 7 of 40, adds the steward in 18 of 40 and Tam's aunt
in 7, and since change 4 a change of sides comes with a none in 4 of 60. The rerun's mean rates are 0.89 for rule checks and 0.65 for
judgment checks.

## Scoring Tam and Vane themselves

The checks that Tam Rook and Edric Vane are added matched any new
character whose name held "tam" or "vane", so a reply adding only Tam
Rook's aunt or Vane's son passed. They now match the character's own
name. Scored again, Tam is added in 25 of 30 runs before the character
bar and 27 of 40 with it, Vane in 8 of 30 and 6 of 40. The replies
that leave Tam out under the bar cite it: they misread "ran the same
night" as his death and ask whether a dead boy is one "the story could
come back to", a test the bar sets only for an unnamed character.
Along with the steward and Tam's aunt, the bar ended the stand-ins for
the ambush's lead, a "narrator", a "protagonist" and an "unknown" in 3
of 30 replies before it.

## Two recoveries in code

The developer asked for both of the fixes left to code.

- **A change of sides.** The planner now plans a none at the same turn
  as a joined faction first, whichever the reply wrote first: both
  start from the faction the character held, so the pair is the leave
  before the join. A join and a cast-out within one turn read the same
  way, the cost canon names. Replayed, Brann ends in House Varro in
  every run, among them change 2's and 3's, where 3 of 10 had left him
  in no faction.
- **Bracketed IDs.** A reference or turn handle a reply copies with the
  prompt's brackets, `[c1]` or `[t2]`, is read as the bare one when
  that resolves; 4 of 300 replies wrote them so. The eval now resolves
  turn handles as the pass does. Replayed, change 6's recounted replies
  read Nessa's learning in 10 of 10, against 8, and change 3's reveal
  reply lands its rename and alias.

## Where it stands

Every change so far, with the check it was made for. The baseline and
change 1 ran five times a window, the rest ten; the mean rates are
over the checks as they now score, the baseline's read through the
slip recovery.

| Change             | The check it was made for                        | Before → after | Rule / judgment mean |
| ------------------ | ------------------------------------------------ | -------------- | -------------------- |
| baseline           |                                                  |                | 0.74 / 0.64          |
| 1, knownAwareness  | knownAwareness names only a listed happening     | 11/25 → 17/25  | 0.83 / 0.60          |
| 2, headings        | the same                                         | 37/50 → 49/50  | 0.86 / 0.66          |
| 3, threadStatuses  | every ID names a listed row or a declared handle | 38/50 → 47/50  | 0.87 / 0.65          |
| 4, change of sides | Brann ends in House Varro                        | 7/10 → 9/10    | 0.89 / 0.63          |
| 5, titles          | calls that drop a happening                      | 4/50 → 0/50    | 0.91 / 0.65          |
| 6, character bar   | replies naming an ambush rider                   | 10/30 → 7/40   | 0.89 / 0.69          |
| 7, witnesses       | Brannoc aware of the wreck; reverted             | 0/10 → 16/20   | 0.90 / 0.74          |

Left, each for the developer or measured as out of a rule's reach:

- **The steward** under the character bar, in the followup.
- **A witness's awareness.** The Awareness rule asks for the
  characters the prose shows learning a fact, so no reply puts
  Brannoc, who watched the wreck he recounts, in its awareness; change
  7's wording fixed that at the cost of Idris's learning, in the
  followup.
- **A none beside a join** could also be settled in the planner, a
  none and a join for one character at one turn read as the leave
  before the join, which would hold for any model; it would change
  canon's apply order, so it was left.
- **The lead.** Replies take the silent drover Pell for the ambush's
  "you" and leave Tobin out of most happenings (2 to 5 of 10).
- **The cover name.** No reply reads "Mistress Penn, sir, from
  Tanner's Row" as Ilse naming herself; the reasoning takes Penn for
  the fishmonger or a third person, so the Names rule, which already
  sends a disguise to aliases, never comes into play.
- **A character named later in the window.** Twice in the 300
  replies since change 2 the scarred man was added unnamed, his own
  handle then renamed Dov Hask, a rename the planner drops, so Hask is
  lost.
- **One happening a beat.** The fight is never one happening (1 of 70
  runs), the followup's "what counts as a happening".
- **Tam Rook made dead** swings between 3 and 7 of 10 with no change
  near it, and Vane, named and dead, is added in 1 to 5.
