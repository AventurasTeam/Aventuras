# Import dialog pattern

Pure-View Dialog that runs every `.avts` JSON import in the
app — file pick or clipboard read → envelope meta-check → zod
payload validation → emit. Single canonical compound consumed by
World/Plot per-row imports, Vault calendars import, and Story
List story import. Domain-agnostic; the host supplies the format,
schema, payload key, and the `onValidated` handoff.

Used by:

- [World per-row import](../screens/world/world.md#per-row-import)
  — entity (`aventuras-entity`) and lore (`aventuras-lore`)
  per-kind imports.
- [Plot per-row import](../screens/plot/plot.md#manual-creation--per-row-import)
  — thread (`aventuras-thread`) and happening
  (`aventuras-happening`) imports.
- [Vault calendars · From JSON file](../screens/vault/calendars/calendars.md#from-json-file)
  — `aventuras-calendar`.
- [Story List · Story import](../screens/story-list/story-list.md#story-import)
  — `aventuras-story`.

The envelope contract — `format`, `formatVersion`, payload sub-key,
per-UI gated rejection — is canonical at
[`data-model.md → Aventuras file format`](../../data-model.md#aventuras-file-format-avts).
This pattern doc owns the **dialog UI shape and validation
pipeline**; the data-model doc owns the envelope spec.

## Why one component, not per-host variants

The contract at every callsite is identical: a host opens the
dialog with a `format`, a `supportedMajor`, a `payloadKey`, a
zod `schema`, and an `onValidated` handler. The dialog runs the
same three-stage pipeline (read → meta-check → payload-validate)
and either fires `onValidated(payload)` or surfaces the failure
with copy keyed off the failure mode. Every host's success path
is different (Vault assigns a fresh UUID; story-list routes to
the reader; per-row creates a row and selects it) but those are
host-side effects, not Dialog UI variants — pure-View Dialog +
host-supplied effect handler keeps the compound's contract
tight.

The trigger affordance varies per host (`+ New X ▾` menu via
`ImporterMenu` for world / plot / vault-calendars; flat
`[Import story…]` Button for story-list), so the trigger lives
with the host. This mirrors the `CollisionResolveDialog` and
`EmbedderDownloadDialog` precedent.

## Props

```ts
type ImportDialogProps<TPayload> = {
  open: boolean
  onOpenChange: (open: boolean) => void

  // Envelope contract — per data-model.md → Aventuras file format
  format: `aventuras-${string}` // expected `format` field, exact-match
  supportedMajor: number // accepts files where `formatVersion.major === supportedMajor`
  payloadKey: string // envelope sub-key, e.g. 'calendar', 'story', 'entity'
  schema: ZodSchema<TPayload> // validates the payload sub-object

  // Copy
  title: string // dialog title, e.g. 'Import calendar', 'Import story'

  // Outcome
  onValidated: (payload: TPayload) => void // fires on success; Dialog closes itself after
}
```

Generic over `TPayload`. The host typically narrows
`TPayload` via the zod schema and threads the inferred type
through to its action layer.

## States

Five states drive the dialog body. Header (title + ×) and footer
(`Cancel`) persist across all states; the body content swaps.

```
idle          → two input buttons, no error
reading       → spinner on active source, both buttons disabled
meta-error    → wrong-format / wrong-major banner, both buttons re-enabled
payload-error → "Invalid format — N issues. [Show details]" + collapsed details
(success)     → onValidated fires; Dialog self-closes via onOpenChange(false)
```

Transitions are linear: `idle → reading → (meta-error |
payload-error | close)`. Any error state → user clicks either
input button again → back to `reading`. Closing during `reading`
discards the in-flight read (settle handlers compare a
`requestId` ref before any state mutation).

## Dialog body — idle

```
┌── Import calendar ─────────────────────────┐
│                                             │
│   ┌──────────────────────────────────────┐  │
│   │  📁  Choose .avts file…              │  │
│   └──────────────────────────────────────┘  │
│                                             │
│   ┌──────────────────────────────────────┐  │
│   │  📋  Import from clipboard           │  │
│   └──────────────────────────────────────┘  │
│                                             │
│   .avts and .json files supported.          │
│                                             │
│                              [ Cancel ]     │
└─────────────────────────────────────────────┘
```

The hint line at the bottom is fixed copy; the extension policy
(`.avts` canonical, `.json` accepted) is canonical at
[`data-model.md → Extension policy`](../../data-model.md#aventuras-file-format-avts).

### Picker mechanics

- **Web file picker.** A visually-hidden `<input type="file"
accept=".avts,.json">` lives inside the dialog body, clicked
  programmatically from the `📁` Button. The input's
  `value` is reset to `''` before each click so the same file
  can be re-picked after an error.
- **Native file picker.**
  `expo-document-picker.getDocumentAsync({ type:
['application/json', 'application/octet-stream'] })`. Android
  doesn't reliably MIME-type `.avts`; the dual MIME accept-list
  plus extension dispatch covers it. URI returned →
  `readAsStringAsync(uri)` from `expo-file-system/legacy`.
- **Web clipboard.** `navigator.clipboard.readText()`. Available
  on HTTPS / localhost / Electron contexts. Feature-detect on
  mount; if absent, the `📋` Button renders disabled with
  `disabledReason="Clipboard access not available."` (kept
  rendered for stable layout).
- **Native clipboard.** `expo-clipboard.getStringAsync()`.

### Disabled-state gating

Both buttons during `reading` are gated via inline
`pointerEvents: 'none'` style — className-only gating doesn't
fully block clicks on web (see
[`icon-actions.md → Disabled vs hidden`](./icon-actions.md#disabled-vs-hidden)
for the rationale on disabled affordances generally; the
underlying inline-style mechanic is the same).
Disabled visual treatment is `opacity-50` plus muted text.

## Validation pipeline

Three stages, each owning one failure mode. The categorical
split — meta-error vs payload-error — is the user-facing
contract; the pattern doc is the source of truth.

### Stage 1 — Read

Async load → string. Failures here are transient meta-errors
with a banner shape (no `[Show details]`), because there's no
parsed JSON to dig into:

- File read I/O failure → `⚠ Could not read file.`
- Clipboard read failure / permission denied
  → `⚠ Clipboard access denied.`
- Empty clipboard → `⚠ Clipboard is empty.`

If Stage 1 returns a string, the spinner clears and Stage 2 runs
synchronously.

### Stage 2 — Parse + meta-check

`JSON.parse` the string, then walk the envelope header. All
failures here are meta-errors. Each branch maps to a categorical
copy line:

- `JSON.parse` throws or result is not a plain object
  → `⚠ This file isn’t valid JSON.`
- `parsed.format` missing or not a string starting with
  `aventuras-` → `⚠ This isn’t an Aventuras file.`
- `parsed.format !== props.format` (exact match,
  case-sensitive) → `⚠ This is a different kind of Aventuras
file (got <parsed.format>, expected <props.format>).`
- `parsed.formatVersion` missing or shape-invalid (must match
  `/^(\d+)\.(\d+)$/`; `"1"`, `"1.0.0"`, `"v1.0"` all fail)
  → `⚠ This file is missing version information.`
- Parsed `major < props.supportedMajor`
  → `⚠ This file is from an older version of Aventuras.`
- Parsed `major > props.supportedMajor`
  → `⚠ This file is from a newer version. Update Aventuras to
import.`
- `parsed[props.payloadKey]` missing
  → `⚠ This file is missing its <payloadKey> data.`

Stage 2 does **not** use zod. Hand-rolled envelope inspection
keeps the meta-error surface categorical; mixing zod here would
push meta-failures into payload-error's field-list shape,
collapsing the distinction.

### Stage 3 — Payload zod validate

`props.schema.safeParse(parsed[props.payloadKey])`.

- `.success === true` → fire `props.onValidated(result.data)`,
  then `onOpenChange(false)` (Dialog self-closes).
- `.success === false` → payload-error state; flatten
  `result.error.issues` into rendered lines.

**Forward compatibility.** Zod's default `.strip` behavior
discards unknown keys; a `formatVersion: "1.1"` payload with new
fields validates against the v1.0 schema and the host receives a
payload with the new fields stripped. See
[`parked.md → Forward-compat field-loss UX advisory`](../../parked.md)
for the open question on whether to surface this to the user.

### Issue flattening

```
['calendar', 'units', 0, 'name']  →  'calendar.units[0].name'
['calendar', 'eras']              →  'calendar.eras'
```

String keys joined by `.`, numeric indices wrapped in `[]`.
Helper lives in `import-dialog-pipeline.ts`; not a published
primitive.

Path-truncation rule: each rendered line trims path to ≤ 40 chars
with middle-elision (`calendar.…s[0].name`) and message to ≤ 80
chars with tail-elision.

## Error UI

### Meta-error banner

```
┌── Import calendar ─────────────────────────────────┐
│                                                     │
│   ┌── ⚠ This file is from a newer version. ────┐    │
│   │     Update Aventuras to import.              │    │
│   └──────────────────────────────────────────────┘    │
│                                                     │
│   [ 📁  Choose .avts file…             ]            │
│   [ 📋  Import from clipboard          ]            │
│                                                     │
│                              [ Cancel ]             │
└─────────────────────────────────────────────────────┘
```

Warn-tinted banner (per the toast / banner `warn` token).
Re-enabled buttons below. Clicking either re-runs the pipeline.

### Payload-error collapsed

```
┌── Import calendar ─────────────────────────────────┐
│                                                     │
│   ⚠ Invalid format — 3 issues. [Show details ▾]    │
│                                                     │
│   [ 📁  Choose .avts file…             ]            │
│   [ 📋  Import from clipboard          ]            │
│                                                     │
│                              [ Cancel ]             │
└─────────────────────────────────────────────────────┘
```

Pluralization: `1 issue.` / `N issues.`

### Payload-error expanded

```
┌── Import calendar ─────────────────────────────────┐
│                                                     │
│   ⚠ Invalid format — 3 issues. [Hide details ▴]    │
│   ┌────────────────────────────────────────────┐    │
│   │  • calendar.units[0].name — required        │    │
│   │  • calendar.units[2].length — number > 0    │    │
│   │  • calendar.eras — must be an array         │    │
│   └────────────────────────────────────────────┘    │
│                                                     │
│   [ 📁  Choose .avts file…             ]            │
│   [ 📋  Import from clipboard          ]            │
│                                                     │
│                              [ Cancel ]             │
└─────────────────────────────────────────────────────┘
```

**Scroll behavior — tier-dependent:**

- **Desktop / tablet:** details list is `max-height: 200px` with
  internal vertical scroll. Dialog body height stays compact.
- **Phone:** details list expands inline with no max-height;
  the whole Dialog body becomes scrollable (single scroll
  surface — no nested scrolls).

The details list is read-only — no per-issue affordances. Users
fix and re-pick / re-paste.

## Per-host integration

### World per-row entity import

```tsx
// One slot per dialog; the host holds an entity slot and a lore slot.
const entityImport = useRowImport<EntityImport>({
  blocked: editBlocked, // isUserEditBlocked: refused while generation is in flight
  focused, // screen focus: losing it closes the dialog, which stays closed when it returns
  guard, // the surface's leave guard
  select, // an ok commit runs guard(() => select(id)), then onImported
  commit: (payload) => importEntity(branchId, payload, ctx),
  onImported: () => toast.success(t('world:import.imported')),
  onRejected: (code) => toast.error(importRejectionText(code)),
  onFailed: (error) => {
    logger.error('app.world_import_failed', {
      branchId,
      category,
      error: error instanceof Error ? error.message : String(error),
    })
    toast.error(importFailureText())
  },
})

<ImportDialog<EntityImport>
  {...entityImportDialog(category)} // format, schema narrowed to the kind, t('world:import.title.<kind>')
  open={entityImport.open}
  onOpenChange={entityImport.onOpenChange}
  onValidated={entityImport.onValidated}
/>
```

The importer menu's `From JSON file…` option calls `request()`, which
opens the dialog through the leave guard and is refused
while generation is in flight. The dialog closes itself as it hands
the payload to `onValidated`, before the commit settles, so the
outcome is reported outside it: on success the hook selects the new
row through the leave guard and the host toasts `Imported.`;
otherwise the host shows the refusal / failure toast. Lore is the
parallel case with `loreImportDialog()` and its own slot.

**Kind-narrowing is mandatory** for `aventuras-entity` consumers.
Without the `.refine` on `kind`, a `kind: 'location'` JSON
imported via the Characters selector would validate against the
base entity schema and emit a wrong-kind payload to the
character creation handler. The narrowed schema surfaces the
mismatch as the payload-error banner `⚠ Invalid format — 1 issue.`
whose `[Show details]` line reads `kind — Expected a character.`,
giving the user a clear redirect.

### Plot per-row import

Identical shape to world per-row. Each kind:

- `format='aventuras-thread'`, `payloadKey='thread'`,
  `schema=ThreadImportSchema`
- `format='aventuras-happening'`, `payloadKey='happening'`,
  `schema=HappeningImportSchema`

### Vault calendars

```tsx
<ImporterMenu
  label="+ Add calendar"
  options={[
    { key: 'clone-builtin', label: 'Clone built-in…', onPress: openCloneBuiltinModal },
    { key: 'from-json', label: 'From JSON file…', onPress: () => setImportOpen(true) },
    {
      key: 'from-scratch',
      label: 'From scratch',
      disabled: true,
      disabledReason: 'Lands when L3 design pass ships.',
    },
  ]}
/>

<ImportDialog
  open={importOpen}
  onOpenChange={setImportOpen}
  format="aventuras-calendar"
  supportedMajor={1}
  payloadKey="calendar"
  schema={CalendarSystemSchema}
  title="Import calendar"
  onValidated={(calendar) => {
    importCalendarAction(calendar).then(
      (newId) => router.push(`/vault/calendars/${newId}`),
      (error) => {
        logger.error('app.calendar_import_failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        toast.error(t('vault:import.failed'))
      },
    )
  }}
/>
```

Vault-specific bits (fresh UUID on import, name-collisions
allowed, success route to L2 detail) live in the action layer
and the route — the Dialog only validates shape. The dialog has
closed by the time the action settles, so the host reports a
failure itself, as the World host does.

### Story list

Flat-button trigger. No menu.

```tsx
<Button variant="secondary" onPress={() => setImportOpen(true)}>
  <Text>Import story…</Text>
</Button>

<ImportDialog
  open={importOpen}
  onOpenChange={setImportOpen}
  format="aventuras-story"
  supportedMajor={1}
  payloadKey="story"
  schema={StoryImportSchema}
  title="Import story"
  onValidated={(story) => {
    importStoryAction(story).then(
      (branchId) => router.push(`/reader-composer/${branchId}`),
      (error) => {
        logger.error('app.story_import_failed', {
          error: error instanceof Error ? error.message : String(error),
        })
        toast.error(t('landing:import.failed'))
      },
    )
  }}
/>
```

The reader route is keyed by branch, so the action resolves to the new
story's branch. As with vault calendars, the host reports a failure.

Legacy `.avt` migration import is a separate parallel path with
its own dialog and design pass — see
[`parked.md → Legacy .avt migration import`](../../parked.md#legacy-avt-migration-import).
`ImportDialog` is strictly `.avts`.

### Host gating during in-flight generation

Per
[`principles.md → Edit restrictions during in-flight generation`](../principles.md#edit-restrictions-during-in-flight-generation),
edits to active-story content are gated during generation.
Per-row imports into the active story should be gated by the
host (host doesn't mount the trigger, or mounts it disabled). A
dialog already open when the gate engages closes, discarding any
in-flight read, and stays closed when the gate lifts. The World and
Plot hosts also close it when their screen loses focus or the
category / segment switches.
Vault calendars (global) and story-list story-import (new story)
are unaffected.

## Storybook

One stories file at
`components/compounds/import-dialog.stories.tsx`. Story matrix:

| Story                      | State         | Notes                                                                                                                                                                     |
| -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IdleCalendar`             | idle          | `aventuras-calendar` + `CalendarStubSchema`; default open. Anchors visual reference.                                                                                      |
| `IdleStory`                | idle          | `aventuras-story` + `StoryStubSchema`; demonstrates title-copy variation.                                                                                                 |
| `IdleCalendar_Phone`       | idle          | Renders as `IdleCalendar`; resize the canvas below 640px to verify button text doesn't truncate.                                                                          |
| `Reading`                  | reading       | Forced via test seam; spinner on file button, both disabled.                                                                                                              |
| `MetaError_NotAventuras`   | meta-error    | Forced via `_initialState`. Banner: `This isn’t an Aventuras file.`                                                                                                       |
| `MetaError_WrongKind`      | meta-error    | Forced via `_initialState`: an `aventuras-story` envelope into a `aventuras-calendar` dialog.                                                                             |
| `MetaError_NewerVersion`   | meta-error    | Forced via `_initialState`: `formatVersion: "2.0"` vs `supportedMajor: 1`.                                                                                                |
| `MetaError_ClipboardEmpty` | meta-error    | Forced via `_initialState`: the empty-clipboard banner.                                                                                                                   |
| `PayloadError_Collapsed`   | payload-error | Forced; multi-issue zod failure; details hidden.                                                                                                                          |
| `PayloadError_Expanded`    | payload-error | Same shape with 10 issues; click `Show details` to open the list and see the bounded scroll.                                                                              |
| `ClosedDuringRead`         | reading       | Stubbed clipboard read; Cancel mid-read, then resolve: `onValidated` never fires.                                                                                         |
| `Closed`                   | n/a           | Story with a Button that toggles `open`; demonstrates host wiring at a glance.                                                                                            |
| `Host<Slot>_NewerVersion`  | meta-error    | One per host slot (World Characters, Locations, Items, Factions, Lore; Plot Threads, Happenings) with that host's shipped config. Mock clipboard: `formatVersion: "2.0"`. |
| `HostCharacters_WrongKind` | payload-error | Mock clipboard: a valid location in the Characters slot; one issue at `kind`, `Expected a character.`                                                                     |

### Forced-state test seam

Transient states (`reading`, the various error variants) are
forced via an optional `_initialState` prop on `ImportDialog`
(`import-dialog.tsx`), which it passes to `useImportPipeline` in
`import-dialog-pipeline.ts`; it defaults to `{ kind: 'idle' }`.
The underscore prefix marks it test-only. The dialog resets the
pipeline on open ↔ closed transitions, never on mount, so a dialog
mounted open keeps its forced state.

## Accessibility

- **Dialog semantics.** Inherited from
  [`Dialog` primitive](../../../components/ui/dialog.tsx) via
  `@rn-primitives/dialog`. Title wires through
  `DialogPrimitive.Title`.
- **Focus management.** On open, focus moves to `📁 Choose .avts
file…`. The Dialog primitive returns focus to the trigger on
  close. During state transitions, action-button focus is
  retained; error regions announce via `role="alert"` (web) /
  `accessibilityLiveRegion="assertive"` (RN) rather than
  stealing focus.
- **Hidden file input (web).** `aria-hidden="true"` plus
  visually hidden styling; the visible Button owns the
  accessible label.
- **Spinner / reading state.** Active button receives
  `aria-busy="true"` (web) and
  `accessibilityState={{ busy: true }}` (RN). Disabled state
  via inline `pointerEvents: 'none'` plus `opacity-50`.
- **Disclosure (Show details).** `accessibilityRole="button"`
  on the toggle; `aria-expanded` /
  `accessibilityState={{ expanded }}` reflects state. Focus
  stays on toggle on expand (does not jump into the list).
- **Error copy.** All categorical copies lead with `⚠ ` for
  visual emphasis; accessible names strip the glyph (announces
  as `"This is a different kind of Aventuras file…"`, not
  `"warning sign…"`).

## Implementation prerequisites

The dialog's native dependencies are installed and in use:

- `expo-document-picker` — the native file picker
  (`getDocumentAsync`).
- `expo-file-system` — `readAsStringAsync` loads the picked file. It
  is imported from the `expo-file-system/legacy` subpath: in SDK 55
  the package root's copy throws when called.
- `expo-clipboard` — the native clipboard read.

The dialog loads all three lazily, on first use, so a dev client
built before one was added fails only when that path runs. Each
carries native code: per
[`lessons-learned/native-dep-expo-link.md`](../../implementation/lessons-learned/native-dep-expo-link.md),
adding such a module needs a dev-client rebuild before it runs on a
device.

Web has no native-build step — `<input type="file">` and
`navigator.clipboard.readText()` are standard browser APIs and
work in Electron's renderer context as-is.

## Open questions

None blocking v1. Related open items:

- **Native overlay impl vs JS-based overlay** (open question, owned
  here — not blocking, no ledger entry) — both `Sheet` and `Dialog`
  are built on `@rn-primitives/dialog`
  (JS overlay); should the native paths migrate to native
  `<Modal presentationStyle="formSheet">` per
  [`ui-native-modals.md`](../../../.agents/skills/vercel-react-native-skills/rules/ui-native-modals.md)?
  Affects future iterations of this Dialog along with every
  other overlay compound on native.
- [`parked.md → Forward-compat field-loss UX advisory`](../../parked.md)
  — surface dropped-unknown-field information when importing
  newer-minor-version files? Currently silent.
- [`parked.md → Pre-import payload preview`](../../parked.md)
  — "About to import: Story 'Foo' (15 entries, 3 branches,
  8 entities)" preview screen before commit. Real value for
  large imports; not in v1.
- [`parked.md → Drag-and-drop file import for ImportDialog`](../../parked.md)
  — common web UX; carve out from v1 unless real demand
  surfaces.
