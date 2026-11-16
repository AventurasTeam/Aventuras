# Settings on a story's model override

How a story's model override carries its own call settings. Designed
2026-11-17 from the UX followup "Story model overrides carry no
settings", raised by the developer 2026-10-31 in the chapter-close
agent design.

## Why

A story's override names a provider and a model, nothing else.
`resolveModel` (`lib/ai/resolve-model.ts`) returns `params: {}` for
one, so a call under it sends no temperature, max output, thinking,
timeout, structured-output mode or custom JSON. A close step still
caps itself at its 8k fallback, and a pass or a close keeps its ten
minutes, but a turn's narrative call under an override goes out with
no output limit. A `lore-mgmt` override can't set the close's two
switches either. Then the failure surfaces mislead: a reply cut off
under an override names "the narrative profile's max output" and
offers `Fix profile`, though no profile reached the call (M7.1's
roadmap item on it).

Canon chose this on purpose: an override was insulated from profile
changes, and `parked.md → Granular per-story model controls` waited
for demand, leaning toward settings on the override over a
story-specific profile id. The followup is that demand.

## Decisions

The canon is
[`story-settings.md → Models tab`](../ui/screens/story-settings/story-settings.md#models-tab--overrides-only),
[`patterns/model-settings.md`](../ui/patterns/model-settings.md) and
[`data-model.md → Story settings shape`](../data-model.md#story-settings-shape). In short:

- **An override is a model tuned for this story.** It carries its own
  settings, owned by the story, rather than pointing at an App
  Settings profile (developer decision).
- **It starts as a copy.** Picking a model where a slot has no
  override copies the settings the slot resolves to at that moment;
  re-picking the model keeps them. A broken chain copies nothing.
- **Every field a profile has**, limited to the slot: a narrative
  override holds the narrative profile's fields, an agent override adds
  structured output, a `lore-mgmt` override adds the Chapter close
  switches. Custom JSON included.
- **One settings type, two owners.** `ModelSettings` is shared; a
  profile adds `id`, `kind`, `name`, `description` and `modelRef`, an
  override adds `providerId` and `modelId`, flat as today. Model-only
  overrides parse unchanged, every setting unset.
- **The same form on both screens,** as a new pattern. App Settings ·
  Profiles keeps only what is profile-specific.
- **`fromOverride` travels with the failures.** The resolver result,
  the cut-off failure and the capability hint carry it, and
  `metadata.cutOff` persists it. Copy says whose setting it was when the
  call ran; the action follows where the setting lives now: every
  `Fix profile` reads `Fix story override`, the label the
  override-provider-missing entry already uses, when the story
  overrides the slot. 5.10's can't-call-tools copy names the model, so
  only its action changes.
- **Data and logic in a plan-mode followup, the form in M7.1**
  (developer decision). The copy at creation is logic and ships with
  the followup.

## Approaches

**What an override is for.**

- **Chosen: a different model, tuned for this story.**
- **Rejected: a different profile.** Cheap, but it gives up insulation,
  and with one narrative profile the narrative slot has nothing to
  point at.
- **Rejected: either, per override.** Two shapes for one slot.

**Where an override's settings start.**

- **Chosen: a copy of what the slot resolves to.** An override never
  starts worse than the agent it replaces.
- **Rejected: blank.** A narrative override would still send no limit,
  the gap the followup names.
- **Rejected: `PROVIDER_DEFAULTS`.** No entry for `openai-compatible`,
  so it falls back to blank where the developer runs.

**Which fields.**

- **Chosen: all of a profile's.**
- **Rejected: all but custom JSON**, today's exclusion. The copy would
  drop a profile's custom JSON silently.
- **Rejected: only the followup's five.** A `lore-mgmt` override could
  never leave `split` and `separate`.

**Storage.**

- **Chosen: settings on the override itself.**
- **Rejected: story-owned profiles,** `models[agent] = { profileId }`.
  A profile list, names and dangling ids inside Story Settings, for
  sharing across agents no one asked for.
- **Rejected: only the fields that differ,** inheriting the rest at
  render. Contradicts the copy and insulation.

**The form.**

- **Chosen: the same fields component.**
- **Rejected: an Assignments-style profile dropdown to copy from.** The
  copy of the slot's profile, then a model change, covers it.

**Build timing.**

- **Chosen: split.** Data and logic in a plan-mode followup; the form,
  with its Slider primitive, in M7.1 beside the profile editor.
- **Rejected: all now.** No Slider exists in `components/ui`; the form
  would be the app's first model-settings UI, ahead of the profile
  editor it shares.
- **Rejected: all in M7.1.** Overrides would keep running on `{}`
  through M5 and M6.

## Adversarial pass

- **Load-bearing: the copy at creation.** Without the form, an override
  takes its profile's settings unseen. Accepted: a profile's settings
  have no editor before M7.1 either, and there are no users until the
  MVP. Until then `Fix story override` lands on a tab without the form;
  removing and re-picking the override copies the profile again.
- **Missed surfaces.** The first count was six; the chapter close's
  cut-off copy and its two capability hints name "the lore management
  profile's" settings too (`locales/en/reader.json`). Canon states the
  rule, every surface naming an agent's profile setting, not a list. The
  wizard's copy names a global agent and is unaffected.
- **Where copy is built.** A system entry words its text when the
  failure is written (`components/reader/system-entry-actions.tsx`), so
  it reads `fromOverride` once, from the failure; only the card's
  cut-off notice renders from stored metadata, so only `metadata.cutOff`
  persists it. `systemFailure` gains nothing.
- **One name.** The resolver's field and the failures' are the same
  fact, `fromOverride`, a `boolean` in memory and `?: true` on the mark.
- **Read sites, verified.** Eight `resolveModel` callers: the turn, the
  piggyback narrative, close metadata and `generate.ts` read `params`
  already; `call-timeout.ts` gets the override's timeout; `preflight.ts`
  is untouched, since 5.10's failure copy names the model;
  `describeChain` drops story overrides; `wizard-assist.ts` is global.
- **zod strips unknown keys,** so the close switches can't sit on an
  override before M7.1 adds them to `ModelSettings`, for both owners at
  once.
- **Custom JSON** is sent by no call today (M7.1). `paramsOf` already
  carries it, so a fix that reads resolved params sends an override's
  too; assumed, and noted on that item.
- **Accepted:** a broken chain at creation copies nothing, so a
  narrative override sends no limit, as today; a profile raised later
  doesn't reach the story, which is insulation.
- **Unaffected, checked:** export strips `settings.models`; a new
  story starts with `models: {}`; branches share story settings; a Save
  during a run reaches the next call, as a profile edit does.

## Drift pass

Applied with the developer's go-ahead:

- **Profile-only wording** where an override now sets the value: the
  pass's and a structured call's timeout, `structuredOutput`'s
  mechanism, the deletion and export paragraphs on overrides.
- **The close controls are segments,** not switch rows, in the pattern.
- **Ledger:** M7.1's force-on item threads resolved settings, not the
  profile; Slice 5.2's pointer moves to the new followup; M7.1's
  provider-deletion item drops the routing half canon already answers.
- **Two restatements that disagreed with canon** (App Settings' hint,
  reader-composer's "the table above") now defer to
  `generation-pipeline.md`, and the entry card's is cut to its copy.
- **Inventory:** build-ready rows for the Slider and the form.

## Integration plan

- **`data-model.md`:** `settings.models`' block and comment; scope
  policy 2; the profile block built on `ModelSettings`;
  `metadata.cutOff`'s `fromOverride`.
- **`architecture.md`:** the models resolver paragraph.
- **`generation-pipeline.md`:** `ReplyCutOffFailure.fromOverride`, the
  `reply-cut-off` routing paragraph, the capability hint's copy and
  action.
- **`ui/patterns/model-settings.md`** (new) and the patterns README.
- **`app-settings.md`:** Profiles' field list moves to the pattern;
  the capability-hint paragraph under Override semantic.
- **`story-settings.md`:** the Models tab: the override row and its
  form, the copy at creation, insulation, the v1 exclusions, the data
  block.
- **`principles.md`:** Models are override-only.
- **`chapter-close.md`:** Conversations' override line.
- **`reader-composer.md`:** the failure table, the cut-off and hint
  copy, the suggestion strip's error state.
- **`entry-card.md`:** the cut-off notice; **`reader-document.md`:**
  `cutOffFixLabel`.
- **Wireframes:** `story-settings.html`'s Models tab gains an override
  row with its form; `app-settings.html`'s profile comments point at the
  pattern.
- **Ledgers:** the followup is replaced by "Story overrides' settings
  aren't built"; `parked.md → Granular per-story model controls`
  leaves; M7.1's override cut-off item shrinks to its `unknown` note,
  its close-switches and custom JSON items gain an override line, and
  a new item holds the Models tab form; 5.10's slice doc gains the
  `Fix story override` line and its open question's premise.
