# Slice 4.4 — Story Settings basic surface

## Metadata

- **Milestone:** [Milestone 4 — World + Plot read surfaces](../milestone.md)
- **Depends on:** none (day-one; extends the merged M3.11 shell and
  its section-registration seam — M3's C7, not this milestone's — the
  M3.7b Authoring aids section, the M3.1b Memory-tab embedder section,
  and the shipped `ProviderModelPicker`). Milestone-level validation of
  the keyword-retrieval panel follows [Slice 4.2b](./02b-lore-history-delete.md),
  whose keyword editors make keywords authorable; that is a
  verification order, not a build gate.
- **Blocks:** none in M4 (M7.2 extends this surface later)

## Goal

The Story Settings screen becomes the basic surface real data needs:
the **Models** tab (narrative override plus the five story-agent
overrides over `resolveModel`), the **About** tab with the story-list
`Edit info` route, the Generation tab's **Authoring aids** completed
with the composer-modes toggle and wrap POV (bringing the
definitional-change confirmation for `composerWrapPov`), the
**Memory** tab's chapter-close, prompt-context, classifier-cadence,
retrieval-budget and keyword-retrieval knobs, the **story-open
embedding upgrade prompt** beside `SwapResumeHost` with both `Keep`
write sites, and the phone save-bar placement call. The M7.2 boundary
is drawn here: definitional fields, the classifier status panel and
`piggybackMode` gate, Pack, Calendar, Translation, Advanced and Probe
stay deep.

## Background

M3.11 shipped the route, the eight-tab rail with placeholders, and a
save session that merges per-section patches into one
`updateStorySettings` write (no delta, no CTRL-Z — `stories` is
absent from `deltas.target_table`). Sections join through
`useStorySettingsSection` and must own disjoint top-level keys. Three
carried deferrals land here: composer modes are unreachable on every
real story because nothing can flip `composerModesEnabled`; the five
`keywordRetrieval` knobs are in the schema with no UI, and
`mode: 'inject'` is a behaviour users will expect to reach; and the
story-open upgrade prompt is specced with no host. About edits
`stories` columns, not JSON — that needs a small new arm beside the
M2.4 favorite and archive setters, and a session commit that can carry
a column patch beside the settings patch.

## Required reading

- [`story-settings.md → Layout`](../../../../ui/screens/story-settings/story-settings.md#layout)
  and [`Two sections under one roof`](../../../../ui/screens/story-settings/story-settings.md#two-sections-under-one-roof--wizard-editable-vs-post-creation-tuning)
  — the About tab's fields live in the section split.
- [`story-settings.md → Models tab — overrides only`](../../../../ui/screens/story-settings/story-settings.md#models-tab--overrides-only)
  through [`Data model`](../../../../ui/screens/story-settings/story-settings.md#data-model)
  — note the `Agent overrides` list includes `wizard-assist`, which
  the `Data model` block, the schema and `resolveModel` all exclude;
  this slice follows the schema and fixes the doc line.
- [`story-settings.md → Generation tab`](../../../../ui/screens/story-settings/story-settings.md#generation-tab--definitional-fields--authoring-aids)
  (the Authoring aids grouping) and
  [`Definitional-change confirmations`](../../../../ui/screens/story-settings/story-settings.md#definitional-change-confirmations)
  through [`When the story is empty`](../../../../ui/screens/story-settings/story-settings.md#when-the-story-is-empty).
- [`story-settings.md → Memory tab`](../../../../ui/screens/story-settings/story-settings.md#memory-tab):
  [`Chapter close`](../../../../ui/screens/story-settings/story-settings.md#chapter-close),
  [`Prompt context`](../../../../ui/screens/story-settings/story-settings.md#prompt-context),
  [`Classifier`](../../../../ui/screens/story-settings/story-settings.md#classifier)
  (the cadence-config bullet only; status block and `piggybackMode`
  are M7.2),
  [`Embedder`](../../../../ui/screens/story-settings/story-settings.md#embedder)
  (for the second `Keep` write site only),
  [`Retrieval budgets`](../../../../ui/screens/story-settings/story-settings.md#retrieval-budgets),
  [`Keyword retrieval`](../../../../ui/screens/story-settings/story-settings.md#keyword-retrieval).
- [`story-settings.md → Mobile expression`](../../../../ui/screens/story-settings/story-settings.md#mobile-expression)
  and [`patterns/save-sessions.md → Save bar`](../../../../ui/patterns/save-sessions.md#save-bar--the-visible-ui)
  — the two canon lines the phone save-bar call weighs.
- [`memory/cadence.md → User-tunable knobs`](../../../../memory/cadence.md#user-tunable-knobs)
  — the buffer-aware cadence indicator and the `classifierContextEntries`
  floor.
- [`memory/retrieval.md → Keyword injection`](../../../../memory/retrieval.md#keyword-injection),
  [`Keyword injection budget`](../../../../memory/retrieval.md#keyword-injection-budget),
  [`Per-type retrieval budgets`](../../../../memory/retrieval.md#per-type-retrieval-budgets)
  and [`The story-open upgrade prompt`](../../../../memory/retrieval.md#the-story-open-upgrade-prompt).
- [`principles.md → Models are override-only`](../../../../ui/principles.md#models-are-override-only-per-story),
  [`Composer mode`](../../../../ui/principles.md#composer-mode--send-time-transform-narration-aware)
  and [`Stack-aware Return`](../../../../ui/principles.md#stack-aware-return).
- [`architecture.md → Settings`](../../../../architecture.md#settings-strict-types-defaults-at-load)
  — `resolveModel`'s chain and the M2 C3 failure vocabulary the
  sentinel renders.
- [`patterns/provider-model-picker.md → API`](../../../../ui/patterns/provider-model-picker.md#api).
- [`story-list.md → Story card`](../../../../ui/screens/story-list/story-list.md#story-card--text-first)
  — the `Edit info` entry and its stack-aware Return.
- [`data-model.md → Story settings shape`](../../../../data-model.md#story-settings-shape)
  and [`Story identity fields`](../../../../data-model.md#story-identity-fields).
- [Slice 3.11 → Implementation notes](../../03-memory-floor/slices/11-story-settings-shell.md#implementation-notes),
  [Slice 3.7b → Implementation notes](../../03-memory-floor/slices/07b-suggestion-settings.md#implementation-notes)
  and [Slice 3.2 → Scope: out](../../03-memory-floor/slices/02-piggyback.md#scope-out)
  — the seam's real shape, the two queued calls this slice owns, and
  where `piggybackMode`'s UI was deferred.

## Scope: in

- **Models tab:** the always-visible Narrative row with the
  `App default: <model> (<profile>)` sentinel from `resolveModel`
  (or the typed failure rendered as the broken-chain state),
  `ProviderModelPicker` to pin a model id, `×` to clear;
  `+ Add override` opening a picker over the five story agents
  (`classifier`, `translation`, `suggestion`, `lore-mgmt`,
  `retrieval` — `wizard-assist` is a global agent with no story slot)
  each showing its resolved chain; override rows with picker and `×`;
  a section joining the save session owning `models`; the
  `story-settings.md → Agent overrides` line naming `wizard-assist`
  corrected in this PR.
- **Provider-qualified overrides:** `settings.models[target]` becomes
  `{ providerId, modelId }` (schema, migration `0014` adopting the
  current default provider for stored bare ids, `resolveModel`
  resolving on the override's own provider, `defaultProviderId` dropped
  from the resolver config); canon amended in `data-model.md`,
  `story-settings.md` and `architecture.md` in this PR.
- **About tab:** `title`, `description`, `tags` (`TagInput`), accent
  color (`ColorPicker`, `(none)` = mode-derived, stored as null),
  library status segment (`active` / `archived`), favorite `SwitchRow`
  with star; cover **deferred** (asset gallery); a new column arm for
  the `stories` fields beside the M2.4 setters; the section joins the
  save session and the provider's commit gains an optional **column
  patch** written in the same transaction as the settings patch.
- **`Edit info` routing:** the story card's `onEditInfo` boots the
  story and lands on About, pushed over the library, so the first `←`
  is an ordinary stack pop back to it.
- **Authoring aids completion:** `composerModesEnabled` `SwitchRow`
  (adventure-only — disabled with a hint in creative mode) and
  `composerWrapPov` segment (`1st` / `3rd`) added to the M3.7b section;
  the **definitional-change confirmation modal** at save for
  `composerWrapPov` when the story has entries (built generically over
  the flagged-field table so M7.2 adds `mode`, `narration` and
  `activePackId` by listing them). The Generation-tab warn-box is
  **not** added here — its copy describes genre / tone / setting,
  which land with M7.2.
- **Memory tab knobs**, each a section on the save session: chapter
  threshold chip-row presets plus custom input and `chapterAutoClose`;
  `fullChapterInBuffer` with the projected-cost line,
  `partialChapterBuffer` (greyed in full mode), `protectedBuffer`,
  `classifierContextEntries` (min 2), `classifierCadence` with the
  buffer-aware overlap indicator and warning chip (partial mode only);
  the five `retrievalBudgets` inputs; the **Keyword retrieval** panel
  (`mode` select with explanation; `budgetShare`, `scanEntries`,
  `cascade` and `cascadeMaxDepth` disclosed only under `Inject`).
- **Story-open upgrade prompt:** an app-level host beside
  `SwapResumeHost`, keyed on the open story and mounted after the
  crash-recovery and swap-resume hosts. Its **gate** is what keeps it
  from portaling beside either — mount order alone does not — and it
  refuses on a swap marker, a running swap or a pending recovery
  report, and unless the story's `embedding_model_id` differs from a
  set app default that `embedding_upgrade_declined` does not already
  name. Three actions: `Upgrade` fires the shipped `SwapDialog`; Keep
  (canon copy: Keep on the current model) writes the declined key;
  `Later` defers for the session, and is what Esc and hardware back
  map to. The shipped `SwapDialog`'s own `Keep` (the Memory-panel
  path) writes the same key — the second write site.
- **Phone save bar:** the one-line deliverable is that a dirty session
  is visible from the phone rail state; the placement decision is an
  [open question](#open-questions) below and lands with its canon
  amendment in this PR.
- **Tab-qualified invalid reason:** the snapshot already publishes
  `invalidSectionId` and each section its `tab`; surface the tab
  beside the reason in the save bar now that more than one section can
  be invalid.
- **Storybook:** each new section (empty / populated / disabled /
  invalid), the sentinel states, the confirmation modal, the upgrade
  prompt, the phone save-bar placement.

## Scope: out

- Generation's definitional fields (`mode`, `lead`, `narration`,
  genre / tone / setting), their confirmations and the tab's warn-box
  — M7.2.
- The Classifier status block, `Run classifier now`, and the
  `piggybackMode` toggle with its structured-output capability gate —
  M7.2 (deferred there by Slice 3.2; the setting is readable since
  M1.5). The Embedder section is unchanged apart from the `Keep`
  write.
- Probe section — M7.5.
- Pack, Calendar, Translation, Advanced tabs — M7.2.
- Cover upload — the asset gallery pass.
- The standalone `Re-index this story now` button — shipped in M3.1b;
  untouched.
- App Settings' story-defaults mirror of the Memory knobs — M7.1.

## Acceptance criteria

- Pinning a narrative override writes `settings.models.narrative`;
  the next turn's request in the mock LLM's recorded requests carries
  that model id; clearing the override restores the sentinel and the
  chain (E2E over the mock provider; vitest on the section patch).
- Adding a `classifier` override writes `settings.models.classifier`
  and `resolveModel('classifier')` returns it; `×` restores the chain
  sentinel; `wizard-assist` is not offered (vitest on `resolveModel`
  and the section patch; component test on the picker list).
- The sentinel renders the resolved `<model> (<profile>)` and, with
  the assignment removed, the `no-profile-assigned` state without
  throwing (component test).
- `Edit info` on a card lands on About with the fields populated;
  editing `title` and saving updates the card; the first `←` returns
  to the library, a second visit's `←` follows the stack (E2E).
- A save with an About column edit and a Memory-tab knob both dirty
  commits in one transaction; a rejected column patch rolls the
  settings patch back (vitest on the provider commit).
- Enabling composer modes on an adventure story makes the reader's
  mode picker appear on return; the toggle is disabled with a hint on
  a creative story; changing wrap POV on a story with entries raises
  the confirmation modal and `Save anyway` commits (component tests on
  the picker gate and the modal; vitest on the flag detection).
- Cadence 12 with partial buffer 10 shows the warning chip; switching
  to full mode hides it; `classifierContextEntries` cannot go below 2
  (component test).
- Setting keyword mode to `Inject` discloses the three inject-only
  controls (scan depth shows in both modes); the saved
  `keywordRetrieval` patch matches the schema; a keyworded lore row is
  seated in the next turn's prompt (E2E via the probe capture, over a
  lore row seeded with keywords).
- Opening a story whose `embedding_model_id` differs from the app
  default shows the prompt once; `Keep` writes
  `embedding_upgrade_declined` and the prompt stays away on reopen;
  changing the app default to a third model brings it back; `Later`
  brings it back next launch; a pending swap marker suppresses it
  (vitest on the gate matrix).
- A dirty session with the rail collapsed on phone surfaces the save
  bar, and the chosen placement is written into
  `story-settings.md → Mobile expression` in the same PR (Storybook
  viewport plus component test).
- Two sections dirty and one invalid: the save bar names the tab of
  the invalid one (component test).
- Every chrome string routes through `t()`; new compounds have stories.

## Tests

- Vitest: section patches per tab, About column-patch commit and
  rollback, upgrade prompt gate matrix, confirmation-modal flag
  detection, cadence overlap arithmetic, `resolveModel` with
  overrides.
- Component tests: Models tab states, knob constraints, keyword
  disclosure, modal, picker gate, phone save-bar placement,
  tab-qualified reason.
- Storybook: the matrix above.
- E2E (desktop): override → turn over the mock provider; `Edit info`
  round trip; keyword inject via the probe capture.

## Open questions

- **Phone save-bar placement** — **Resolved during execution:** the
  bar lifts to surface level on phone; see
  [Implementation notes](#implementation-notes).
- **About's column patch through the settings session** — **Resolved
  during execution:** the section contract gained an optional column
  patch; see [Implementation notes](#implementation-notes).
- **Upgrade prompt vs the other app-level hosts** — **Resolved during
  execution:** the upgrade prompt never portals with the other two;
  the resume and recovery pair still can, which predates this slice
  and is triaged. See
  [Implementation notes](#implementation-notes).
- **Story Settings title isn't `Breadcrumb`** (2026-09-11) —
  **Resolved during execution:** the title converted to `Breadcrumb`,
  with the story segment going through the unsaved-changes guard and
  the phone detail route appending its tab segment; see
  [Implementation notes](#implementation-notes).

## Implementation notes

Resolved developer decisions and deviations worth carrying forward. The
cross-cutting findings went elsewhere and are the bigger artefact:
sixteen items in [triage](../../../triage.md), three entries under
[lessons-learned](../../../lessons-learned/README.md) (the save-session
story harness, the renamed disabled `IconAction`, and the React Compiler
suppression), and four deferrals routed straight into
[the roadmap's M7](../../../roadmap.md#m7--app-settings--diagnostics--onboarding)
because a named slice will own them.

- **One PR, and it outgrew the review cap.** The slice was sized at
  roughly 65-75 files across four E2E specs and shipped whole rather
  than split. It landed at 99 source files before the documentation
  commits, and 123 with them, so CodeRabbit's 100-file review limit —
  carried as a monitor item rather than a gate — is exceeded. A slice
  this shape wants splitting into stacked PRs by module layer next
  time; commits stay focused per task so a human review can still walk
  them.

- **Model overrides became provider-qualified.** The picker always
  yielded a `{ providerId, modelId }` pair while `settings.models`
  stored a bare id that `resolveModel` ran on the app's default
  provider — so an override could silently resolve on the wrong
  provider. The override is now the pair end to end, with three
  consequences worth naming: migration `0014` rewrites stored bare ids
  onto the current default provider and drops the key when no default
  is set; `resolveModel` looks the override's own provider up and
  returns `override-provider-missing` when it is gone, so a deleted
  provider leaves story overrides in place rather than silently
  re-pointing them, and the reader's fix action routes to the story's
  Models tab instead of a healthy App Settings chain; and
  `ResolveModelConfig.defaultProviderId` is removed, since
  nothing resolves against an ambient default any more. `.avts` export
  already strips `settings.models`, so no export travels a provider id.
  Canon amended in `data-model.md`, `story-settings.md`,
  `architecture.md`, `generation-pipeline.md`, `app-settings.md` and
  `reader-composer.md`.

- **The phone save bar lifts to surface level.** Canon put the bar
  inside the detail pane, which on phone means a dirty session
  collapsed back to the tab list shows no bar at all. It now renders
  below whichever pane the phone shows, list state included. The lift
  lives in `StorySettingsShell`, which reads `useTier()` a second time
  to know when `MasterDetailLayout` has collapsed — a seam worth
  closing with a `footer` slot on the layout, triaged rather than done
  here because App Settings needs the same treatment.

- **About commits through the settings session, not a second one.**
  `SectionRegistration` gained an optional `getColumnPatch`, `onCommit`
  receives `{ settings?, columns? }`, and a new
  `saveStorySettingsSession` action runs both op sets in one
  transaction with `updateStorySettings` kept as a thin wrapper. One
  save bar, one commit, no churn for the sections that predate it. The
  plan's standalone `updateStoryInfo` action was dropped during
  execution: nothing called it once About commits through the session,
  so the column arm is just `setStoryInfoOps` in
  `lib/db/stories/story-info-ops.ts`.

- **"Story is empty" means no turn on any branch.** The literal
  no-entries rule was unreachable — every wizard story carries an
  opening entry — so the definitional-change modal fires on
  `storyHasTurns`, which counts entries whose kind is neither
  `opening` nor `system`. Refined during execution: a transient system
  failure notice does not count either, since it is cleared before the
  next submit. The check is a denylist, so an entry kind added later
  counts as a turn until it is listed. It lives in
  `lib/actions/story-entries/has-turns.ts` as an entry read rather than
  in the stories actions, because that is the table it reads.

- **The title converted to `Breadcrumb`.** It rendered one flat
  `<title> / Story Settings` string, so the story segment was not the
  tappable parent
  [`principles.md → Breadcrumb tappability`](../../../../ui/principles.md#breadcrumb-tappability)
  asks for, and the phone detail route carried no `/ <tab>` segment.
  The story segment now routes to the reader through
  `session.requestLeave` so the unsaved-changes guard still fires; on
  phone the `Story Settings` segment collapses detail back to the
  list, and the detail route appends the tab label.

- **`Edit info` is a plain stack push — no one-shot Return slot.** The
  story card pushes `/story-settings/<id>?tab=about` over the library
  after booting the story, so the first back is an ordinary stack pop
  and the navigation store gained no one-shot target. Draft cards get
  no `Edit info` (a draft has no branch to boot). On phone the sequence
  is About → tab list → library. The Contextual Return paragraph in
  `story-settings.md` is corrected to match.

- **The Memory tab is one section, not five.** A single `memory-knobs`
  registration owns `chapterTokenThreshold`, `chapterAutoClose`,
  `fullChapterInBuffer`, `partialChapterBuffer`, `protectedBuffer`,
  `classifierContextEntries`, `classifierCadence`, `retrievalBudgets`
  and `keywordRetrieval` over one draft, rendered as five
  presentational sub-sections — sections must own disjoint top-level
  keys, and splitting them would have split one draft five ways for no
  gain. `classifierContextEntries` renders under Prompt context only,
  where the user reasoning about buffer sizes will look for it.

- **The classifier-context stepper has a UI ceiling of 20.** The floor
  of 2 is real — the action and the reply the classifier reads — while
  the ceiling is a UI convenience with no schema counterpart, declared
  as `CLASSIFIER_CONTEXT_MAX` beside the knob rules.

- **The retrieval-budget hint canon asks for is skipped.** Canon wants
  each budget shown as a share "of remaining tokens after structural
  inject"; this surface has no per-turn estimate to compute that from,
  so the budgets render as five plain inputs plus a total line. The
  window-level accounting that would make the hint meaningful is
  already routed to M7.2 in the roadmap.

- **`resolveModel`'s success result carries `profileId`.** The Models
  tab's sentinel needs the profile's _name_, which the resolver has no
  business formatting. It now returns the id it landed on — set on the
  profile path, absent on the override path, which is also how the
  panel tells the two apart — and the panel looks the name up in
  `appSettingsStore.profiles`.

- **Both `Keep` write sites record the app default.** The plan said the
  Memory panel's `SwapDialog` would record the selected candidate's id;
  canon (`retrieval.md` → Keep on the current model) says the
  suppression describes the model the user turned _down_, which is the
  app default in both places. Corrected during execution; the prompt
  and the dialog now write the same key.

- **The upgrade prompt latches per story open.** The gate is a pure
  function in `lib/embedder-swap` read once per `openStory` event, not
  continuously, so an app default moved mid-session waits for the next
  open. `Later` defers through a session-scoped per-story set on
  `embedderSwapStore`; any answer — `Upgrade` included — ends the
  prompt for that open, so cancelling the swap dialog does not re-raise
  it. The gate refuses while a swap marker, a running swap or an
  unacknowledged recovery report exists, so the prompt never portals
  beside the other two app-level hosts. The resume and recovery hosts
  can still stack with each other; that predates this slice and is
  triaged.

- **Composer defaults decided (2026-09-14).** Composer modes are on by
  default — a per-story opt-out, not an opt-in — and the wrap POV
  default follows the story's mode at creation: `first` for adventure,
  `third` for creative. App Settings' wrap POV default seeds new
  adventure stories only, since modes never run in creative and the
  value only matters if the story later switches. Existing stories keep
  their stored values: both fields are required in the stored settings,
  so nothing migrates. Landed in `buildStorySettings`; canon amended in
  `principles.md`, `app-settings.md` and `data-model.md`, with both
  wireframes.

- **Scan depth shows in both keyword modes (2026-09-14).**
  `keywordRetrieval.scanEntries` sizes the keyword scan surface under
  `Boost` as well as `Inject`, so the control shows in both modes;
  canon's inject-only disclosure is amended in this PR.
