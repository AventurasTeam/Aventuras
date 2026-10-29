# Measuring the classifier prompt

The record behind the followup "Classifier prompt: interface and
structure": the periodic classifier's prompt measured against a
hand-written evaluation set before any change to its structure, then
one measured change at a time. Started 2026-10-28.

## The evaluation set

Five windows in `scripts/classifier-eval/`, a sixth added after change
10, each a few turns of hand-written prose over a small hand-written
roster, built in memory and rendered as the pass renders a branch. The parse probe sends them
with `PROBE_EVAL`
([`testing.md → Real-provider checks`](../testing.md#real-provider-checks)).

| Window    | What it exercises                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------- |
| ambush    | a fight across two turns, in second person; the lead named only by the scene, beside a silent drover                    |
| recounted | an event thirty years before the story, told by a witness who hands over evidence                                       |
| reveal    | a listed stranger gives her name, an epithet, then a cover name                                                         |
| defection | a sergeant changes sides; an agent wears his old faction's coat as a disguise                                           |
| learning  | a character learns of a listed happening; a listed relationship the prose restates; a fled boy, a steward               |
| namedrops | names only invoked, a saint in an oath, a king in a saying, a song's maker, beside a named man the story sets out after |

Each check is marked `rule` when a rule in the prompt asks for the
fact and `judgment` when only the window's author does; every window
also checks that each ID a reply names is a listed row or a handle the
reply declares. The developer reviewed the windows on 2026-10-28,
`namedrops` after change 11. Left unscored on purpose: whether the
steward becomes a character, and whether the page changing hands is a
happening, since piggyback records the item and who gave it. After change 9 the developer added
the warrant's signer in `defection`, whom Brann demands, so the story
may be heading for him.

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

## Change 8: awareness is whoever knows

The developer settled what change 7 had raised: awareness is a
character knowing of a happening, however they came to it, a witness
or a teller as much as someone told. Change 7 had asked that of a
happening the reply adds while knownAwareness still took only those
who learn of a listed one, and two of its four misses on Idris had
recorded Oriel, the poisoning's teller, by adding the poisoning again,
the one place left for him. Both rules now say knowing. The Awareness
rule opens "List only characters the prose shows knowing of it,
however they came to: who witnessed it or took part, and who learns of
it", and the knownAwareness rule takes a character "knowing of one,
learning of it ("Kael tells Aria about the massacre") or knowing it
already (Kael, who tells it)", with learnedAtTurn only when the turns
narrate the learning. The field's description and canon say the same.
Brannoc's check became a rule check, and the learning window gained
one: Oriel, who tells of the poisoning, knows of it.

Expected to move: Brannoc and Oriel, 0 of 20 each on the kept prompt;
at risk, Idris's learning and the poisoning added again, 19 of 20 on
the kept prompt, the unrelated fire, and awareness spreading.

| check                         | the kept prompt (20 runs) | change 7 (20 runs) | change 8 (10 runs) |
| ----------------------------- | ------------------------- | ------------------ | ------------------ |
| Brannoc aware of the wreck    | 0                         | 16                 | 10                 |
| Oriel knows of the poisoning  | 0                         | 1                  | 8                  |
| Idris learns of the poisoning | 19                        | 16                 | 9                  |
| the poisoning not added again | 19                        | 17                 | 10                 |

No reply added the poisoning again. The one Idris miss wrote no
knownAwareness and no happening at all, as one reply on change 7's
prompt did. The fire held. Awareness rows rose to 1.7 a happening,
against 0.5 on both runs of the kept prompt, those who took part now
among them, and Pell, taken for the ambush's "you", is aware in 24 of
its happenings. The mean rate of rule checks is 0.89 against 0.86
and 0.85, of judgment checks 0.72 against 0.76 and 0.72. Kept.

Two reveal replies added Ilse Marrow as a new character beside the
right rename, "the Heron" as its keyword instead of an alias, one
citing the bar: she is named. With the bar a reply does it in 3 of 50
runs, and in none of 30 before it.

## Change 9: the story's direction as the character bar

The developer judged change 6's bar by where the story is heading: the
steward and Tam's aunt belong, since Oriel sets out to find the aunt
and the steward is hunting Tam, while the ambush riders fought, fled
and nothing points back to them. The bar also had to stop costing
named characters, and a revealed name had to stay a rename. The rule
now asks for "every named one, whether alive, dead or only spoken of,
and an unnamed one the turns point the story toward, someone a
character sets out to find or to face, or who is after one of them",
not "an unnamed figure the scene is done with, even one who took
part", "and not a listed character whose own name the turns reveal:
that is a rename". Canon's bullet says the same.

| replies adding       | the bar's five runs (50) | change 9 (10) |
| -------------------- | ------------------------ | ------------- |
| Tam Rook             | 36                       | 10            |
| Edric Vane           | 8                        | 10            |
| Ilse as someone new  | 3                        | 0             |
| the archer           | 10                       | 2             |
| the third rider      | 7                        | 2             |
| the steward          | 24                       | 8             |
| Tam's aunt           | 8                        | 5             |
| Vane's son           | 2                        | 4             |
| Brann's brother      | 0                        | 3             |
| the Marigold, a ship | 1                        | 3             |
| the Teeth, a reef    | 0                        | 1             |

The named characters came in, Vane among them, involved in the wreck
in 3 of 10, and no reply took Ilse for someone new. The riders barely
moved, and the steward and the aunt rose, as the developer's bar has
it. Two over-reaches came with it: "every named one" took the
Marigold, a ship, and the Teeth, a reef, for characters, and the
hanged brother, unnamed and dead, came in on "dead or only spoken of",
so defection's check against its extras fell to 7 of 10. One reply
added "the man who signed that warrant", whom Brann demands, so the
story does point at him; the check, written before this bar, counts
him as noise. The mean rate of rule checks is 0.92 against 0.89, of
judgment checks 0.68 against 0.72. Kept, the over-reach the next
change's.

## Change 10: a person or creature, and no part that is over

The bar now asks for "every named person or creature, whether alive,
dead or only spoken of, but never a named ship, place or thing", and
leaves out an unnamed figure the scene is done with, "nor one whose
part is over ("a porter", "a sailor who helped haul the net", "a
father long dead")". Canon's bullet says the same.

Expected to move: the Marigold, the Teeth and the hanged brother, 3, 1
and 3 of 10 on change 9's prompt; holding, Tam, Vane, the steward, the
aunt, and Ilse kept a rename.

The ship, the reef and the brother came in no reply, and defection's
check against its extras read 10 of 10 again. Tam and Vane held at 10
of 10, Vane involved in the wreck in 7, and the steward and the aunt
came in 9 and 5 times. Two replies took Ilse for someone new again,
and one added "Mistress Penn", her cover name, as another. A reply
named an ambush rider in 6 of 10: each adds the archer to give the
skirmish an involvement, its reasoning never turning to the bar, and
across the bar's runs the count went 0, 1, 3, 3, 3, 2 and now 6, a
swing no version of the bar has moved. The mean rate of rule checks is
0.94 against 0.92, of judgment checks 0.73 against 0.68. Kept.

## A window of names only invoked, and change 11

A side agent noted that "every named person, whether alive, dead or
only spoken of" has no floor, and that no window held a name dropped
in passing. The sixth window, `namedrops`, has Odo swear by Saint
Aldric's bones, quote old King Harrow and pass on the name of Jorun
Vask, whom Wren sets out to find, while a fiddler plays Merrit's
ballad. Run ten times on change 8's prompt, before the bar asked for
every named person, and on change 10's, Jorun came in every time on
both. On change 10's one reply added King Harrow, weighing him by
"only spoken of", and one the fiddler; on change 8's neither.

Change 11 leaves out a name the prose only invokes, as factions and
places leave out a figure of speech: "Nor is a name the prose only
invokes, in an oath, a saying or a song ("by Saint Mira's tears", "as
Queen Ysolde used to say")", the examples' names other than the
window's. Canon's bullet says the same. Expected to move: the invoked
names and the fiddler; at risk, Tam and Vane, both only spoken of.

No reply added an invoked name or the fiddler, and Jorun held at 10 of
10, though one of ten against none proves little alone. Tam and Vane
missed once each, neither by the new clause: the Vane reply added him
without the description the reply type requires, and the Tam reply
read change 10's "nor one whose part is over" as covering a named boy
it took for dead. The rest moved as a scatter, Oriel's knowing at 5 of
10 against 9 and Vane's involvement at 2 against 7, and two recounted
replies filed their own happening under knownAwareness. The mean rate
of rule checks is 0.91 against 0.95, of judgment checks 0.70 against
0.76, on the six windows. Kept on the mechanism the reasoning shows.

Run again, the final prompt read 0.93 for rule checks and 0.66 for
judgment checks on the five original windows, against 0.90 and 0.64
the first time and 0.94 and 0.73 for change 10: Oriel's knowing came
back to 9 of 10, and the rule checks sit within a reply or two of
change 10's. No invoked name or fiddler came in across the 20 runs.
The one check down on both runs is defection's extras, 8 of 10 twice:
the gate-boy came in 3 times in 20 against none in the 70 runs before,
each reply adding him as "a person in the scene" without weighing the
bar, as the archer is added for the fight. Whether the bar, grown to
six clauses, now reads past is a question for a change to its
structure.

## Change 12: one happening an encounter

The developer settled what counts as a happening: fewer of them, an
encounter spread across four turns stored as one, its description
holding the notable moments, so that a later recall gives a character
the scene to remember. Before the change the final prompt split the
ambush into 3 or 4 happenings a reply (the cut rope, the toll demand,
the skirmish, Sefa's wound), the market meeting into two, and the
alehouse bargain into an offer and an acceptance in half the replies.
Descriptions ran 40 to 220 characters.

Checks came first, as judgment checks: the ambush and the market
meeting are one happening each, a description tells each one's moments,
the bargain is not split, and the wreck's doused lamp is not its own
happening. On the final prompt's two runs they read 0, 2 to 6, 0, 0, 4
to 5 and 7 to 10 of 10. The fight's moments were first marked by the
cut rope, Hask and Sefa's wound; no reply on any prompt tells the rope,
cut before the fight began, so the markers became Hask unhorsed, the
archer shot and Sefa's wound.

Change 12 opens the happening rules with "One happening an encounter":
a happening is one whole event however many turns it runs across, its
beats are not happenings of their own (a duel's insult, blows and
wound; a feast's toasts, quarrel and walkout, examples the windows
don't hold), its sourceTurn is the latest turn it runs to, and its
description tells the notable moments in order, in a few sentences:
"who did what, what was said, given or lost, and how it ended". An
event at another time or place, or one the turns only recount, is
another happening. The description field says the same, and canon's
Happenings bullet with it. The granularity checks became rule checks.

Every check it was made for went to 10 of 10. A reply now holds 1
happening for the ambush and the market, 2 or 3 for defection (the
bargain, the theft, and the brother's hanging when it is added), and
2 for recounted: the wreck, and the lighthouse conversation as an
encounter of its own in every reply. Descriptions run 150 to 320
characters and, in the replies read, tell the scene faithfully: "Brann
accepts, unpins his Warden badge, and pledges his service to House
Varro by kissing Maela's signet." Tam was never made dead, 10 of 10
against 7 and 4.

One check fell: Tobin is involved in 1 reply of 10 against 4 and 6.
The one happening of the fight now carries every actor, and with no
lead named the reply gives the charge to Pell, who never appears in
the prose; two descriptions wrote him as `"[c1]"`. That is the lead's
open item made worse, the subject of change 13. Awareness of a
happening the reply adds was filed under knownAwareness in 5 replies
of 60, against 2 or 3 before, three by the happening's title and two
by an invented ID. The recounted window's judgment check that "the
telling is not a happening" was retired: the lighthouse conversation
is now an encounter of its own, and the check scored only its title's
wording, while Nessa learning of the wreck stays scored as awareness.
Whether a conversation whose substance is a telling and a plan is a
happening at all is the developer's to say. Kept.

## Change 13: the lead, named

The story stores its lead (`leadEntityId`), and a first- or
second-person story or an adventure must have one, but the prompt never
said who it was: "I" and "you" were the lead only by the scene, and
`ambush`'s scene also holds Pell, who never appears in the prose. On
the final prompt Pell was involved in 9 replies of 10 and Tobin in 4
to 6; with change 12 the one happening of the fight went to Pell, Tobin
in 1 reply of 10, and descriptions read "Pell charges the leader".

The user half now names the lead before the turns, when it resolves
on the branch, by the placeholder its own line holds: `The story's lead is [c2] Tobin Ash. Outside quoted speech, "I" and "you" in the turns are the lead.` The system half is unchanged, so the cached
prefix is too, and no other window has a lead, so their prompts are
byte for byte as before; only `ambush` ran. The checks on Tobin, Pell
and "you" became rule checks, with one more: no description tells Pell
in the fight.

Tobin is involved in 10 replies of 10, Pell in none, and no
description names Pell: "Tobin Ash charges the leader, Dov Hask,
knocking him from his saddle." Every other check held, the archer
included, still added in 6 of 10. Kept.

## Prompting practice, researched

The developer asked whether current prompting practice, applied to the
prompt's structure, would improve it. A research pass read the vendors'
guides and the recent measured work; the sources below are as it
reported them, read by it and not checked again here.

- **Gemma 4's own guidance** covers the system role, which it supports
  natively, and thinking mode, and says nothing about structure,
  delimiters, examples or JSON. Everything else is borrowed from
  guidance written for frontier models.
- **Vendor guidance.** OpenAI's GPT-4.1 guide puts instructions at
  both ends of a long context, and notes that on a conflict the later
  wording wins. Google's Gemini 3 guide puts negative and formatting
  constraints last. Anthropic's guide puts the query last and gives
  the reason behind a rule. For reasoning models, OpenAI and
  Anthropic both advise against "think step by step" and prescriptive
  checklists.
- **Measured.** Long reasoning traces degrade compliance with simple
  constraints (MathIF, arXiv 2505.14810; When Thinking Fails,
  2505.11423). Errors under many instructions are mostly omissions,
  smaller models degrade fastest and early instructions fare better
  (IFScale, 2507.11538). Formatting changes move results a lot, but in
  no predictable direction (Sclar et al., 2310.11324). Repeating the
  prompt is about neutral when the model reasons (2512.14982). Few-shot
  examples tend to hurt reasoning models (the DeepSeek-R1 report, and
  Medprompt run on o1).
- **Its ranking for this prompt:**
  1. split the long New characters bullet into labelled parts;
  2. put the new-entity rules and lists ahead of the happenings,
     first if the traces show bystanders created while involvements
     are built;
  3. a static reminder at the end of the user half naming the most
     missed rules;
  4. one delimiter style throughout;
  5. formatting sentences moved into the schema;
  6. a reminder injected into the reasoning;
  7. an example, ranked last.

  Nothing in the list has strong measured support for a 4B-active
  reasoning model.

## S1: the character rule in labelled parts (reverted)

Structure only: the New characters bullet became four labelled
sub-bullets, "Who to add", "Who not to add", "A listed character
under another name" and "The entry", every sentence verbatim. Expected
to move: the ambush's archer and defection's gate-boy, added without
the bar being weighed.

The archer stayed out in 6 replies of 10 against 4, inside the 4 to 10
it has swung through on every prompt, and the gate-boy in 10 of 10, as
before. The rest held within a reply or two. But in 4 of 10 `learning`
replies the unnamed steward, who the developer judged belongs, came
back with an empty name, which the planner drops, so he was kept in 2
replies against 9; no earlier run had blanked an unnamed character
there. Labelled apart from the named, the unnamed one seems to have
been read as having no name to give. Reverted.

## Change 14: a death only in the prose's words (reverted)

The Tam check read only a death-titled happening and a retirement, so
with change 12's descriptions it missed the misread. A check on
descriptions found Tam told as dead in 5 to 9 of 10 replies on every
prompt: "The cupbearer who died the same night as Lady Senna." The
reasoning's first summary of the turn already has it: "Her cupbearer,
Tam Rook, died the same night."

Change 14 added a rule every list keeps: "Deaths. Say a character
died, in a happening, a description or a status change, only where
the turns' own words say so: one who fled, hid or went missing is
alive", leaving out the window's own word, "ran". Run on the four
windows a death touches, Tam was told as dead in 9 replies of 10
against 5, and the reasoning still summarised the turn as his death
before any rule was weighed. Reverted: a misreading at the first
summary is out of a rule's reach on the dev model.

## S2: new characters before happenings (reverted)

Structure only: the rules for new characters and factions, and their
lists in the reply type, moved ahead of the happening rules, every
sentence unchanged. The research ranked it second, and first if the
traces showed bystanders created while involvements are built, which
the archer's do: "new:archer: took part".

The archer stayed out in 9 replies of 10 against 4, but in 5 of the 9
he was declared with an empty name, which the planner drops, so the
bar was no more weighed than before. And the list now written first
was sometimes written empty: 2 ambush replies declared no new
character and still involved `new:dov_hask` in the fight, so Hask was
lost, and 4 recounted replies added no one, Vane added in 6 of 10 and
involved in 2. The model fills the lists in the order given, and it is
in the happenings that it finds who took part. Reverted, with the
prompt back to change 13's.

## Change 15: a bystander told, not involved

The archer's traces show where he comes from: the Involvements rule
lists "who acted", the archer acted, and only a new character's handle
can name him, so the reply adds him, the bar never read. Change 15
adds to the Involvements rule: "A figure who took part but whom the
New characters rule leaves out, an unnamed one the scene is done with,
is not involved: tell their part in the description, and never add a
character only to involve them." Change 12 had made the description
the place for a scene's moments. Canon's Happenings bullet says the
same.

Replies declaring the archer or the third rider fell to 4 of 10 from
7 and 8 on the two runs before, 3 of those 4 with an empty name, which
the planner drops; the archer is told instead: "Sefa shot the archer
in the forearm with a crossbow." Every named character held, Hask,
Vane, Tam and Jorun in 10 of 10, the gate-boy stayed out, and the
steward came in 7 times, inside the 6 to 9 of every earlier prompt.
Kept.

Run again, the final prompt read 0.91 for rule checks and 0.91 for
judgment checks on the six windows, against 0.93 and 0.97 the first
time and 0.81 and 0.86 for change 11's prompt on the checks as they
now stand. The archer came in by name in 5 replies of 10, one of them
as "the unseen archer" who shot Sefa, against 1 the first time: over
the two runs a named archer is created in 6 of 20 against 12 of 20 on
the two runs before the change, half as often, not never. Two
`reveal` replies added Ilse as someone new without renaming her, which
the code's fold can't catch, and one `recounted` call failed to parse
after its retry, the first such failure in the session's runs.

## Two more recoveries in code

Two slips a rule had not stopped are now repaired after the reply
parses, as bracketed IDs were.

- **A reveal written twice.** In 1 or 2 of 10 `reveal` replies the
  model renames the woman in grey to Ilse Marrow and also adds Ilse
  Marrow as a new character. The new row was created first, so the
  rename met a taken name: the stranger kept her old name, gained the
  new one as a keyword and a collision flag, and the user had a merge
  to make. Reconciliation now takes a candidate whose exact name one of
  the reply's own renames gives a row of its kind for that row, before
  any scoring; a shortened or fuller form compares as before. The
  eval's `createdCharacters` mirrors it, so `reveal`'s check scores
  what the planner creates.
- **An ID in prose.** Placeholders are per call, so a description
  storing `"[c1] charged"` names whoever holds `c1` in a later prompt.
  Across every run so far about one reply in 50 wrote a placeholder
  into prose, bracketed or bare, in a description, a title or a
  temporal; change 12, whose descriptions tell who did what, did it in
  2 of its first 13. A known placeholder or handle in a prose field is
  now written as the row's name or title, or the name its handle
  declares, before planning. The eval reads replies the same way.

## The developer's answers, and a third recovery

The developer settled the session's three questions on 2026-10-29. A
conversation is an encounter like any other and stays a happening even
when what it holds is a telling and a plan, which canon now says. Tam
Rook's death is no reading of the turns at all, the dev model
contradicting itself, so it stays as a check to read on other models.
And awareness of a happening the reply itself adds, filed under
knownAwareness by the happening's title, is moved into that happening's
own awareness before planning, unless the happening already lists the
character. Replayed, that leaves only the slips naming an invented ID:
2 replies on change 12's run and on change 15's, 1 on the rerun.

## Change 16: a recounted happening keeps its telling turn

Replayed on the final prompt, 32 of Gemma's 169 happenings carried no
sourceTurn, every one a recounted event with its `temporal`. Their
place in story time held, but their creation, and any awareness row
without a learning turn, anchored at the window head. "When it
happened" said to set `temporal` "instead" for a recounted event,
while Provenance asks for a sourceTurn on every entry, and Gemma read
"instead" literally. The rule now says to set `temporal` too, "its
sourceTurn is then the turn that tells it", and the happening's
sourceTurn field says the same.

Every happening carried a sourceTurn, 0 missing of 78, and one entry
of 240 in any list. The wreck kept its time and Nessa her learning
turn in 10 of 10. Tam came in 7 times against 10 and 10: in each miss
the reasoning took him for dead, then read "nor one whose part is
over" as covering a named character, the open item below. Kept.

## Other models, sampled

The final prompt ran 3 times a window on five more models: Qwen 3.8
flash-next at IQ3_XXS, a second local model, and four hosted through a
subscription, all through the prompt-rendered reply format, no
provider structured output. Gemma's 20 runs are the comparison. Three
replies a window give a direction, not a rate.

| Model                   | Rule / judgment | Median call | Invented or wrong claims |
| ----------------------- | --------------- | ----------- | ------------------------ |
| GLM 5.3 flash           | 0.99 / 1.00     | 103 s       | 0 in 18 replies          |
| DeepSeek v4.1 flash     | 0.99 / 1.00     | 39 s        | 2 in 2 replies, minor    |
| Minimax M3.1 flash      | 0.94 / 1.00     | 24 s        | 2 in 2 replies           |
| Gemma 4 26B-A4B, dev    | 0.92 / 0.94     | 73 s        | 5 in 4 replies           |
| Mercury 2.5, diffusion  | 0.92 / 1.00     | 7 s         | 4 in 4 replies           |
| Qwen 3.8 flash-next IQ3 | 0.88 / 0.86     | 135 s       | 10 in 7 of 16 replies    |

- **GLM and DeepSeek** pass nearly every check. GLM reads Ilse's
  cover name in all 3 replies, the only model to do so every time;
  DeepSeek is the faster.
- **Minimax** recalls well, the steward and the aunt every time, but
  splits encounters: one ambush reply has no happening and another
  makes the cut rope its own; 3 happenings a reply in three windows.
- **Mercury** answers in 7 seconds, its reasoning hidden, with terse
  descriptions and thin recall: the steward and the aunt once each.
- **Qwen** reads Tam's flight right, as every model but Gemma does,
  but scores lowest, and one call ran past the pass's 600 s timeout.

The checks look for moments that must be present and can't see a
moment the prose never had, though under one happening an encounter a
description is the story's memory of the scene. So one reader, blind
to which model wrote what, read every description against the turns.
GLM wrote nothing false. DeepSeek and Minimax slipped twice each,
"three nights past" for three nights after Idris left. Gemma told Tam
dead and moved the lamp's dousing to the Count's men. Mercury invented
"the bodies washed up on the shingle" and had Hask give his name
before he was unhorsed. Qwen reversed the fight's outcome ("the cart
was left at the band's mercy"), set the wreck on "a clear night" and
invented an inquiry. Errors cluster in the fight's order and in the
recounted wreck. Three of the findings were checked against the
replies and hold.

## Where it stands

Every change, with the check it was made for. The baseline and change
1 ran five times a window, the rest ten. The mean rates are every run
scored again on the checks as they now stand, over the five original
windows, so they differ from the figures given at each change.

| Change                 | The check it was made for                        | Before → after              | Rule / judgment mean     |
| ---------------------- | ------------------------------------------------ | --------------------------- | ------------------------ |
| baseline               |                                                  |                             | 0.63 / 0.84              |
| 1, knownAwareness      | knownAwareness names only a listed happening     | 11/25 → 17/25               | 0.68 / 0.84              |
| 2, headings            | the same                                         | 37/50 → 49/50               | 0.73 / 0.88              |
| 3, threadStatuses      | every ID names a listed row or a declared handle | 38/50 → 47/50               | 0.73 / 0.88              |
| 4, change of sides     | a none beside Brann's join                       | 10/20 → 4/60                | 0.74 / 0.88              |
| 5, titles              | calls that drop a happening                      | 4/50 → 0 in every run since | 0.73 / 0.94              |
| 6, character bar       | replies naming an ambush rider                   | 10/30 → 7/40                | 0.74 / 1.00              |
| 7, witnesses           | Brannoc aware of the wreck; reverted             | 0/10 → 16/20                | 0.75 / 0.94              |
| 8, awareness, knowing  | Brannoc aware; Oriel knows                       | 0/20 → 10/10; 0/20 → 8/10   | 0.76 / 0.94              |
| 9, story's direction   | Tam added; Vane added                            | 36/50 → 10/10; 8/50 → 10/10 | 0.79 / 0.86              |
| 10, person, creature   | a ship, a reef, the hanged brother added         | 7 in 10 runs → 0            | 0.82 / 0.88              |
| 11, invoked names      | `namedrops`: an invoked name or the fiddler      | 2/10 → 0/20                 | 0.77 / 0.82, 0.80 / 0.80 |
| 12, one happening      | the ambush, the market one happening each        | 0/20 → 20/20                | 0.91 / 0.80 with 13      |
| 13, the lead           | Tobin involved; Pell in no happening             | 1/10 → 10/10; 0/10 → 10/10  | the same                 |
| S1, labelled parts     | the archer; the gate-boy; reverted               | 4/10 → 6/10; 10 → 10        | 0.90 / 0.90              |
| 14, deaths; reverted   | no description tells Tam as dead                 | 5/10 → 1/10                 | four windows only        |
| S2, new entities first | the archer; reverted                             | 4/10 → 9/10                 | 0.88 / 0.92              |
| 15, bystander told     | the archer and the third rider not added         | 4/10 → 9/10                 | 0.92 / 0.96              |
| 15, run again          | the same                                         | 4/10 → 5/10                 | 0.90 / 0.88              |

Changes 12 and 13 ran together on the five windows, 13 alone on
`ambush`, whose prompt alone it changed. The checks moved several
times this session: the granularity checks became rule checks with
change 12, Tobin's and Pell's with change 13, and Tam's death, the
steward and the aunt were added, so every row reads lower on rules
and differently on judgment than the figures given at each change.
Judgment now rests on five checks, which swing a run's mean widely.

Five fixes went into code: a none beside a join at one turn reads as a
change of sides when the character held another faction; an ID or
turn handle copied with its brackets reads as the bare one; a new
character named as the reply renames a row is that row; an ID in
prose is written as the name it stands for; and knownAwareness naming
the reply's own happening by title is that happening's awareness. Replayed, Brann ends in
House Varro in every run, and no reply adds Ilse as someone new.

Two structure changes the research ranked first were measured and
reverted: labelled parts blanked the unnamed steward's name, and the
new-entity lists written first were sometimes written empty. Neither
moved what it was meant to move by more than the swing.

Left, each for the developer or measured as out of a rule's reach:

- **Tam Rook made dead.** The reasoning's first summary reads "ran the
  same night" as his death, and a description tells it in 5 to 9 of 10
  replies on every prompt; change 14's rule did not reach it, and the
  developer finds no reading of the turns that supports it.
- **Awareness of the reply's own happening** filed under
  knownAwareness by an invented ID, 1 or 2 replies in 60.
- **Vane involved in the wreck** in 2 to 7 of 10 on every prompt,
  though descriptions name the Count's order.
- **The cover name.** No reply reads "Mistress Penn, sir, from
  Tanner's Row" as Ilse naming herself.
- **A character named later in the window**, added unnamed and his own
  handle renamed, a rename the planner drops: at least twice.
- **Oriel's knowing** swings from 5 to 9 of 10 between runs of one
  prompt.
