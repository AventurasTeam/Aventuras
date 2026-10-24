# Story time management and fixes: a user guide

Every entry in an Aventuras story records when, in the story's own world, it begins and ends.
Those times feed the clock in the world panel, chapter summaries, rollbacks and branches. Most
importantly, they feed the generation of new entries (unless you edited a prompt template and
removed the variable that carries them). This guide explains why they drift out of true, and how to
heal a timeline.

Story times are written as year, day and clock, counted from one: `Y1 D4 14:30` is the fourth day
of the first year at half past two in the afternoon. Wherever you type a time you can leave out
what doesn't change, so `14:30` and `D4 14:30` work too.

---

## 0. Time system limitations

Aventuras has no real calendar yet. Years and days are relative: "day 196 of year 1" can be
"5 July 1995" or "15 Mirtul, 1492 DR", depending on the narrative, and that mapping holds up well.
The narrator's reading of the time, however, does not. LLM narrators quickly lose track of the
point of origin once the first few messages fall out of the context window, and "5 hours past
sunset" becomes plain "5 AM". So the most reliable approach is to always treat time as an absolute
value.

## 1. The problem: time drift

Play a story for a while and look at its times, and some of them will be wrong in ways you can
feel:

- a conversation that took an hour is logged as a six-hour debate marathon;
- a night's sleep is counted as a whole 24-hour cycle;
- a five-hour stretch of narration is logged as two hours.

Each error is small. The trouble is that they add up: every entry starts where the previous one
ended, so one wrong step shifts everything after it. By chapter ten the clock can say it's the
morning of day three when the story is plainly on the evening of day five. And the wrong value
doesn't stay in one place. Chapter spans, the clock a rollback restores and a checkpoint's
snapshot are all copies of it.

## 2. The cause: time buckets

Nobody types these times. After each narration, the classifier reads what happened and picks one
of four buckets for how much time passed:

| Bucket  | Meant for          | The clock moves by |
| ------- | ------------------ | ------------------ |
| none    | an instant         | nothing            |
| minutes | a conversation     | 15 minutes         |
| hours   | travel             | 2 hours            |
| days    | sleep, a time skip | 1 day              |

The buckets are coarse on purpose: they date from a time when models couldn't reliably read an
exact duration out of prose. But coarse steps can't follow a story closely. A three-hour dinner is
either 15 minutes or 2 hours; a scene that runs from dusk to midnight has no bucket at all. And the
classifier judges each entry on its own, so nothing corrects an error made three entries back.

Two situations leave an entry with less than a bucket's worth:

- **Classification failed.** The model's answer couldn't be read, or the request didn't complete.
  The entry is then counted as _none_: it ends at the same moment it began, whatever it describes.
- **Not recorded.** Some entries carry no time at all. You'll see _not recorded_ where their time
  would be. This is usually an entry written before the app kept story time. A zero time is a
  close relative: stories created before the opening step asked for a start began at
  `Y1 D1 00:00`, and a zero clock can't be told apart from a missing one.

## 3. The solution: reconcile an interval at once

Correcting an accumulated error entry by entry is a chore nobody wants. Every entry you touch
needs a new start and end worked out by hand, and each correction has to take all the previous ones
into account. Reconciliation turns that around: you say exactly where a few points on the timeline
belong, and everything between them is rearranged to agree.

It does this while keeping the proportions classification established. Each entry keeps its share
of the stretch, with how long it was recorded as lasting as its weight. An entry that was twice as
long as its neighbour stays twice as long. Only the stretch as a whole is stretched or squeezed to
land where you said. Since the original proportions can be off either way (far too short or far
too long), you can also set a weight by hand. Mind that a weight is not a final duration: give an
entry "25 min", and it may end up 34 minutes, 2 minutes or even 2d 15h long, depending on the total
the stretch has to fill.

Everything that copied the old times is updated in the same step: chapter spans, the clock a
rollback would restore, a checkpoint's clock, and the story's current time when the stretch runs
to the end of the story. Either all of it is saved or none of it is.

## 4. Reference points

A reconciliation needs two fixed ends. Those are the **reference points**: entries whose ending
the app treats as known. They come in two kinds.

### Natural boundaries

These exist in every story without any work from you:

- **Beginning**: the end of the story's first entry, its opening;
- **Current end**: the end of the last entry on the branch you're reading;
- **Fork point**: an entry a branch was created from.

A natural boundary stands for the time its entry ends at, as recorded.

**Fork points protect the shared history.** The entries before a fork belong to every branch created
there; the entries after it belong to one branch only. A reconciliation that ran across the fork
would stretch or squeeze the shared entries to fit a point inside one branch, changing the history
all the other branches stand on to suit that one. So a reconciliation never runs across a fork
point: shared entries are only ever fitted between points every branch shares.

A checkpoint is not a reference point. It remembers the clock where it was taken, and that clock
is updated when the entry it was taken at moves, but it doesn't divide the timeline. Still, a
checkpoint is a sign that something significant happened in the story, which makes it a good place
for an anchor. That's why the panel can show checkpoints among the reference points: as a shortcut
for anchoring.

### Time anchors

An anchor is you stating a fact: _I'm sure this happened at this time_. Significant events (the
moment the crime was committed), the turn of a day (midnight) or the end of an arc (the hero
escaping a cave full of goblins) are the natural choices. Strictly, an anchor pins the moment an
entry _ends_, so in a long entry the clock on the wall mid-scene can quite legitimately show a very
different time from the anchor.

There are three places to add one:

1. _Timeline adjustments_ on an entry, where _Create an anchor_ is the second option;
2. the **+** button in the Reference points header of the Timeline panel;
3. the anchor button beside a row in the Timeline panel (checkpoints only).

Give the time the entry ends at and, if you like, a note saying how you know. Only narration
entries can be anchored: a player action is an instant, with no ending of its own, and it moves
together with the narration that follows it.

An anchor does nothing on its own. Existing times stay as they are until you reconcile. What it
does is add a reference point, splitting the timeline into shorter stretches that you can each fix
precisely. An anchor on an entry that's already a natural boundary replaces that boundary's
recorded time with yours.

To change or remove an anchor, open it again from the entry or the panel. _Delete Anchor_ asks
for confirmation first. An anchor at either end of a range can also be edited on the reconcile
screen, where the new time is saved together with the reconciliation.

### Seeing them

The **Timeline** tab of the left panel lists every reference point on the branch you're reading:
Beginning, Current end, each Fork point (marked in amber) and each anchor, with the time each
stands for. Tap a row to jump to its entry. _Show checkpoints_ adds checkpoints to the list for
reference.

Under each row, **Coherence** says whether every stored copy of that moment agrees: the entry's
own ending, a checkpoint's clock and an anchor. _No_ means one of them disagrees. Unfold it to see
which.

## 5. Anomalies

The Timeline panel counts what looks wrong with the branch you're reading. Open the count to see
each finding: the entries it involves, a sentence saying what's wrong, and _Go to entry_. Findings
come in two severities, and fall into these kinds.

**Defects** are provably wrong, from the stored times alone:

- **Missing time**: the entry records no time at all.
- **Reversed**: the entry ends before it begins. Fix it in place, or give it a weight when
  reconciling its range.
- **Backwards**: the entry ends before the entry before it.
- **Overlap**: the entry begins before the entry before it ended.
- **Chapter span disagrees**: a chapter's recorded span no longer matches the entries it covers.

**Suspected** findings are only unusual, and may well be fine:

- **Zero time**: recorded at `Y1 D1 00:00`, which may be a real time or no time at all.
- **Time gap**: time passes between two entries that neither of them accounts for. That's often a
  deliberate skip, and just as often a stretch that got lost.
- **Implausible jump**: a day or more passes within a short entry (under 200 words), the opening
  included.
- **Flatline**: 20 or more entries in a row in which no time passes.

_Hide suspected_ narrows the list to defects. A finding that lies inside a range also has a
_Reconcile_ button, which opens a reconciliation on that range.

## 6. Reconciling a stretch

Open _Reconcile_ from the Timeline panel, or from a finding. The stretch between two neighbouring
reference points is called a **range**, and one is reconciled at a time. The range selector lists
them all. _Go to next range_ moves on once you're done with one. The Reconcile button opens on the
first range, and a finding's _Reconcile_ button opens on the range holding it.

Note that every range **includes** the entry at its end but **excludes** the entry at its start.
So a fork point entry always belongs to the range **before** it, while its ending is where the next
range starts. It also means the very first entry, the opening, is never part of any range: it can
only be edited in place.

### Reference points

At the top, the range's two ends are shown with the time each stands for. Either can be restated
for this reconciliation, and nothing is saved until you press _Apply changes_:

- **Edit**, on an end that carries an anchor, changes the anchor's time (and its note). The anchor
  is saved with the new time when you apply.
- **Assert**, on a natural boundary, sets a time for this reconciliation only. It works like an
  anchor while the screen is open, but no anchor is ever created. A story that opens on your own
  action (an imported chat often does) can be asserted at its start too: the action keeps its
  time, and the range simply begins where you said.

What a restated time does depends on the end:

- **Start.** The range begins at the new time. The entry at the start belongs to the range before
  this one, so it isn't touched: if its recorded ending now differs, a gap or an overlap opens
  just before the range, and the screen says so. An assertion isn't stored, so reconciling the
  range before this one won't close that gap on its own: assert the same time as its End, or
  anchor the entry. At the story's first entry, which belongs to no range, edit its times in place
  instead.
- **End.** The range is fitted to the new time, and applying ends the entry at the end there. Its
  start comes out of the weights, like every other entry's.

A restated end is shown next to the time it replaces, struck through. _Revert_ drops it.

When the end of the range is a fork point and applying would move its ending, a warning under
_End_ says how many branches open there. Those branches start from the new time afterwards, so
reconciling the start of each of them is advised.

If one end has no time, or the later end comes before the earlier one, the screen says so above
the range. You can still read every entry and set weights, but nothing is calculated or applied
until you restate one of the ends.

### Weights

On desktop, the range is shown as a table, which mostly explains itself. On a phone, it's laid
out as a ladder: each point in time is a rung, and each band between two rungs is where something
happens. A band usually holds three cards: the player action, the narration, and the narration's
weight. Consecutive entries that weigh nothing (all classified as instant) share one band; as soon
as any of them is given a weight, they split apart.

- A player action always weighs nothing. Your action is an instant; the time it takes shows up in
  the narration that answers it. The action and its narration are effectively glued together.
- An entry's weight is how long it was recorded as lasting.
- A time gap is both a possible problem and a tool. One can appear when you set the clock by hand in
  the time panel, but you can also add one while reconciling, to account for time that passed
  between two entries without being narrated. An added gap is measured in weight too, not in final
  time.

Any weight can be overridden with _Set custom weight_, in minutes or with units (`2h 30m`, `1d`).
Use it when you know an entry was longer or shorter than recorded, or that a night passed between
two scenes. A weight is a **share, not a duration**: it sets how big a part of the range that
band gets, and the range's two ends still decide the total.

Some entries have no weight the app can read: the ones reported as _Missing time_ or _Reversed_.
They're marked, and the range can't be reconciled until each one is given a weight.

### The outcome

As soon as every weight is known, each entry shows what it **becomes**: its new start and end. The
app adds up all the weights, stretches or squeezes that total to fit the time between the range's
two reference points, and hands each band its share in order.

An example. A range runs from `D2 18:00` to `D3 00:00`, six hours. Inside it are three narrations
recorded as 15 minutes, 15 minutes and 2 hours, with nothing recorded between them. The weights
add up to 150 minutes, and six hours is 2.4 times that. So the narrations become 36 minutes,
36 minutes and 4 hours 48 minutes long. Now say you know half an hour passed between the first and
second scenes, and add a gap whose weight is 30. The total becomes 180, and everything takes
exactly twice its weight: 30 minutes, a 1-hour interval, 30 minutes, then 4 hours.

A few things always hold:

- the last entry of the range ends exactly at the later reference point;
- entries keep their order and their proportions to one another;
- reconciling the same range again, with nothing changed, changes nothing;
- if every weight is zero, the time is shared evenly between the narrations.

When the range reaches the end of the branch, the screen says so: the story's current time moves
with it.

_Apply changes_ saves the new times, along with chapter spans, rollback clocks, checkpoint clocks
and any anchor you edited. If the story changed while the screen was open, nothing is saved, and
the screen shows the refreshed figures to review, keeping what you had set.

Restated ends and weights belong to the range you set them in. Choosing another range or closing
the screen before applying asks first, since they would be lost.

## 7. Editing one entry in place

Sometimes a single entry needs correcting, and you know its correct times. Typically it's the
opening entry of an older story, or the latest one, fresh out of generation. It might also be a
fork point you'll later use as a reference point for reconciliation. You can edit these directly
from the entry's menu or the Reference points list in the Timeline panel. The reconcile screen
doesn't edit an entry's times: its reference points are restated for the reconciliation instead.

This rewrites the entry, along with:

- the player action right before it;
- the chapter spans covering it;
- the checkpoint clock that new branches start from, if there is a checkpoint;
- the story's current time, if this is the last entry.

No other entry moves, so an edit can open a time gap or an overlap with a neighbour. Those show up
as anomalies, and reconciling the range tidies them.

An entry can't be given an end before its beginning: the dialog says so and won't save. Nor can times be edited while the story is generating, since
the running classification would overwrite them. Otherwise an edit is always allowed, but it tells
you what it reaches:

- **The entry carries a checkpoint.** The checkpoint's clock is updated to the new ending.
- **The entry is a fork point.** The checkpoint that branches open on is updated too, so every
  branch created here now starts from the new time. The edit touches several intervals: the one
  ending at this entry, the one continuing on your branch, and the one starting each branch created
  here. Reconciling each of them afterwards is advised.

_What this changes_ folds away once you know it, and stays folded.

## 8. A new story's starting time

Every story has to start somewhere on the clock. The **starting time** is when the story begins,
which is when its opening scene _ends_: the opening covers the moments before the first thing you
do. The opening entry is stamped at that time, and the story's clock starts there.

The last step of the story creation wizard, _Generate Opening_, won't let you _Begin Story_ until
the opening you're using has a starting time that reads as one. There is no calendar here either:
it's a year, day and clock like every other time, and `14:30` alone means the first day of the
first year.

### Each opening has its own

The step offers you up to three openings, and each carries its own **Starting Time** field. They
don't share a value, because a time that fits one opening says nothing about another:

- **Imported Opening Scene**: the first message of a scenario you picked from the Vault. If the
  scenario states a starting time, it fills this field, locked, with the hint _Imported from the
  scenario_. An alternate greeting is a different opening, so it starts with an empty field; so does
  a scenario that states none.
- **Write Your Own Opening**: the field below your own text, which you fill yourself.
- **The generated opening**: the card an AI-generated opening appears in, titled with your story's
  title. Its time comes back with the scene; more on it below.

The story takes the starting time of the opening it's created from. When more than one is ready,
the step uses the generated opening first, then the one you wrote, then the imported one.

As you type, the field shows what your time comes to once days roll over, so `Y1 D400 10:00`
reads `= Y2 D35 10:00`. Times are saved in that form.

### Telling the generator

Under the AI section, **Starting Time (Optional)** is the time you'd like the generated opening to
end at. The generator gets it the same way it gets your title. Left empty, it's asked to suggest a
time that suits the scene.

The generated opening then shows its own **Starting Time**, with a note saying where it came from:

- _Set by generation_: the time came back with the scene.
- _Generation returned no time, so this is the one it was given_: the generator didn't say, and
  your time from the AI section stands in.
- _Set by you_: you changed it.
- _No time set_: neither happened, so you need to give one.

To change it, press _Edit_ on the generated opening; the time is editable while the text is, and
_Cancel_ puts both back. _Refine Further_ keeps your time unless the refinement comes back with a
new one. Generating again always replaces it.

If your prompt pack's opening template was customised before starting times existed, it has
nowhere to put the time. The step tells you so, disables the field in the AI section, and asks the
generator to suggest one instead. To fix the template, add a line like
`TIME: opening ends at {{ storyStartingTime }}` above the protagonist in the pack's opening
templates.

### Setting it in advance

- **Scenario Vault.** A scenario can now carry a starting time, on its _Opening_ tab below the first
  message. It's optional, and it belongs to the first message only.
- **Quick Start Templates.** Every template comes with a starting time that suits its setting, and
  choosing one fills the AI section's time for you.

A starting time is where the story's clock starts, not a statement you've made about it: it
doesn't create an anchor. The opening is the _Beginning_ reference point either way, and you can
anchor it later if the story settles on a different time.

---

## In short

1. Look at **Anomalies** in the Timeline panel to see where the timeline has gone wrong.
2. Where you know what time it really was, drop an **anchor** at that entry.
3. **Reconcile** each range between reference points, adjusting weights where you know better than
   the record.
4. Use **Edit in place** for a single entry you can simply correct.

When you only need a time for one reconciliation, **Assert** it on the reconcile screen instead of
anchoring: it's used for that range and never stored as an anchor.

## Bonus!

You can now give any imported story a timeline. Drop a few anchors, set the times of its first and
last entries, run a reconciliation, and it's there!
