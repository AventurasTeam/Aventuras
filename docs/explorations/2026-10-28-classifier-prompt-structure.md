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
