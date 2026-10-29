# Faithfulness judge brief

The evaluation set's checks look for facts a reply must hold and can't
see one the prose never had. A happening's description is the story's
memory of the scene, so an invented detail becomes a false memory. A
judge reads every description against the turns.

## Running it

1. Save probe runs with `PROBE_OUT`, one directory a run.
2. `pnpm judge:classifier <out-dir> <run-dir>...` writes the judge's
   input into a new or empty `<out-dir>`: `turns/<window>.txt`, each
   window's Known lists and turns as the prompt the runs answered
   showed them; `run-A.md` onward, each run's happenings and new
   characters under a label drawn at random; and `key.txt`, naming
   each label's run. Runs whose prompts showed a window differently
   are judged apart.
3. Give a judge the brief below, with `<out-dir>` filled in, one judge
   a dump. Use a model other than any it judges, so no model judges
   itself.
4. Read `key.txt` only after the results are in.

## Reading the results

Calibrated on 2026-10-29, Sonnet found 20 of the 23 invented or wrong
claims an Opus reader found in the same 108 replies, and ranked six
models the same; most of its 6 other claims the Opus reader had graded
overreach. Judged twice, one run of 60 replies gave 7 and 10 claims, the
second judging finding every claim of the first and missing repeats of
a pattern the first counted. So the counts compare runs judged by one
model and don't give an exact rate. A claim that repeats across many
replies, a misread of the prose rather than a slip, is what a prompt
change can target.

## The brief

A story app's classifier reads a few turns of story prose and writes
structured memory. Each happening it writes has a title and a
description; the description becomes the story's long-term memory of
that scene, and the narrator later recalls it as fact, so a detail the
prose never had becomes a false memory. Find invented or wrong details.

Files:

- The ground truth for each window is in `<out-dir>/turns/<window>.txt`.
  Each holds the Known entities, places and happenings the model was
  given, then the turns `[t1]` onward. IDs like `[c1]` map to names
  there, and a line naming the story's lead says who "I" and "you" are.
- The replies are in `<out-dir>/run-A.md` and the other `run-*.md`
  files. Each lists, by window and reply, every happening as
  `[turn, time] title: description` and every new character as
  `new character Name: description`.

Read every turns file closely first, then every run file in full.

For each description, of happenings and of new characters, flag each
claim the turns and Known lists don't support:

- **invented**: an event, detail, cause, motive or outcome the prose
  never states;
- **wrong**: a claim that contradicts the prose: the wrong actor or
  target, the wrong order of events or outcome, a death or injury the
  prose doesn't state or contradicts, one person taken for another, or
  a wrong time;
- **overreach**: a hedged or reasonable inference stated as fact.

Don't flag paraphrase, compression, omission, or a fact drawn correctly
from the Known lists. Don't flag a title alone unless it states
something false. Judge strictly but fairly: if a close reading supports
a claim, it is not invented. A false claim repeated within one reply
counts once.

Write `<out-dir>/results.md` with one line for each flagged claim, in
exactly this shape:

`run | window | reply | invented|wrong|overreach | "exact quote" | what the prose says`

End it with a table: run, replies read, replies with at least one
invented or wrong claim, invented or wrong claims, overreach claims.
Your final message is that table and two sentences on any pattern.
Don't guess what produced each run.
