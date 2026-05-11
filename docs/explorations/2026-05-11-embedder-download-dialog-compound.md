# 2026-05-11 — EmbedderDownloadDialog compound

Implementation design for the build-ready compound at
[`patterns/embedder-download.md`](../ui/patterns/embedder-download.md).
Resolves the
[`component-inventory.md → Compounds — build-ready`](../ui/component-inventory.md#compounds--build-ready)
row. The pattern doc settles the **feature** (state machine, six
visual states, three init-payload variants, three invocation
surfaces, mobile expression, a11y); this doc settles the
**implementation** (file structure, state-machine API, base
primitive, Storybook strategy, scope boundary with driver
implementations).

## Outcome

Ship the dialog component in isolation: View, container, reducer,
driver-interface type, stub driver. Real driver implementations
(Electron filesystem IPC, expo-file-system, `@huggingface/hub`
fetch, SHA256 computation) are followups gated per-consumer, not
part of this build. The pattern doc's framing — _"this pattern
doc owns the **dialog UI shape** — the host docs own the data
semantics"_ — names the seam exactly.

Wrap a new `Dialog` primitive on the way through. AlertDialog
doesn't fit: the pattern doc's a11y contract (Escape closes;
overlay-click dismisses; `role="dialog"` not `alertdialog`) and
its state-keyed footer shapes (Decline/Accept; Cancel/Retry;
Close; header-cancel during download) contradict AlertDialog's
intended semantics in five places. Wrapping a Dialog primitive is
cheaper than overriding AlertDialog at every consumer.

## Why Dialog, not AlertDialog

Concrete limitations comparing `_tmp/dialog.tsx` (baseline) and
the shipped `components/ui/alert-dialog.tsx`:

| Embedder-download spec contract                                                                                               | AlertDialog default                   | Dialog default                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------- |
| _"Escape closes (resolves as `cancelled` or `declined` per state)"_                                                           | Does **not** close on Escape          | Closes on Escape                             |
| Overlay-click dismiss (standard modal contract)                                                                               | Does **not** dismiss on overlay click | Dismisses on overlay click                   |
| Corner `×` close in `card-fetch`, `license`, `fetch-failed`, `verification-failed` states                                     | None built-in                         | `DialogClose` `×` built into `DialogContent` |
| State-keyed footer shapes: `Decline`/`Accept`, `Cancel`/`Retry`, `Close`, header-cancel during download, no buttons in verify | Prescribed `Action`/`Cancel` slots    | Free `DialogFooter`                          |
| Workflow surface, not an alert                                                                                                | `role="alertdialog"` (interrupts SR)  | `role="dialog"`                              |

Wrapping the Dialog primitive is a 100-line file (`_tmp/dialog.tsx`
with three mechanical adjustments: prettier no-semis, repo tokens
`bg-bg-overlay` / `text-fg-primary` / `text-fg-muted`, and
importing `Text` from `@/components/ui/text` instead of
`react-native`). It adds one row to the inventory's shipped
primitives.

## File layout

```
components/ui/
  dialog.tsx                                 NEW — port _tmp/dialog.tsx with project conventions
  dialog.stories.tsx                         NEW — Default, WithFooter, ThemeMatrix

components/compounds/
  embedder-download-dialog.tsx               NEW — exports View + container; bodies are internal subcomponents
  embedder-download-dialog-machine.ts        NEW — pure reducer + types + initial-state factory + stub driver
  embedder-download-dialog-machine.test.ts   NEW — vitest reducer transition coverage
  embedder-download-dialog.stories.tsx       NEW — one story per state + ThemeMatrix
```

Splitting the machine into its own React-free file means tests run
without a renderer and the View file stays focused on visuals.
State bodies (`LicenseBody`, `DownloadingBody`, etc.) stay
co-located inside `embedder-download-dialog.tsx` — each is 30–80
lines, none are reused outside this compound, so folder ceremony
buys nothing.

## State machine — types

Discriminated-union state, discriminated-union actions; the
reducer enforces transitions at the type level. Side effects live
in the container's `useEffect`s keyed off `state.kind`. The
reducer is pure.

```ts
type ModelMeta = {
  displayName: string
  source: string
  revision: string
  sizeBytes: number
  fileCount: number
}

type FileProgress =
  | { kind: 'waiting' }
  | { kind: 'downloading'; bytesReceived: number; bytesTotal: number }
  | { kind: 'done' }

type FailReason =
  | { kind: 'cancelled' }
  | { kind: 'card-fetch-failed'; message: string }
  | { kind: 'resolve-failed'; message: string }
  | { kind: 'download-failed'; failingFile: string; message: string }
  | { kind: 'validation-failed'; missingFiles: string[] }
  | { kind: 'hash-mismatch'; failingFile: string }
  | { kind: 'smoke-test-failed'; ep: ExecutionProvider }

type DialogInit =
  | { kind: 'catalog'; entry: CatalogEntry }
  | { kind: 'hf-id'; input: string }
  | { kind: 'import'; files: ImportBundle; ep: ExecutionProvider }

type DialogState =
  | { kind: 'hf-input' }
  | { kind: 'resolving'; init: DialogInit }
  | { kind: 'card-fetch'; meta: ModelMeta }
  | { kind: 'license'; meta: ModelMeta; licenseText: string; licenseName: string }
  | { kind: 'ep-picker'; meta: ModelMeta; pickedEp: ExecutionProvider }
  | { kind: 'import-confirm'; bundle: ImportBundle; pickedEp: ExecutionProvider }
  | { kind: 'downloading'; meta: ModelMeta; progressByFile: Record<string, FileProgress> }
  | { kind: 'verifying'; meta: ModelMeta; verifyByFile: Record<string, 'pending' | 'ok' | 'fail'> }
  | { kind: 'done'; meta: ModelMeta }
  | { kind: 'failed'; meta: ModelMeta | null; reason: FailReason }

type DialogAction =
  | { type: 'submit-hf-input'; input: string }
  | { type: 'card-fetched'; meta: ModelMeta; licenseText: string; licenseName: string }
  | { type: 'card-fetch-failed'; message: string }
  | { type: 'license-accepted' }
  | { type: 'license-declined' }
  | { type: 'ep-picked'; ep: ExecutionProvider }
  | { type: 'download-progress'; file: string; bytesReceived: number; bytesTotal: number }
  | { type: 'download-complete'; file: string }
  | { type: 'download-failed'; file: string; message: string }
  | { type: 'all-downloaded' }
  | { type: 'verify-progress'; file: string; result: 'ok' | 'fail' }
  | { type: 'all-verified' }
  | { type: 'verify-failed'; file: string }
  | { type: 'cancel' }
  | { type: 'retry' }
  | { type: 'close' }

type DialogResolution =
  | { kind: 'installed'; meta: ModelMeta }
  | { kind: 'declined' }
  | { kind: 'cancelled' }
  | { kind: 'error'; reason: FailReason }
```

`failed` is one state with a tagged reason rather than five
separate failure states. This keeps the "Close → resolves as
`error(reason)`" path uniform and the View's failure-body switch
small. Reason-specific copy lives inside `FailedBody`.

Initial-state factory (in the machine file):

| `init.kind`        | initial `DialogState`                              |
| ------------------ | -------------------------------------------------- |
| `catalog`          | `{ kind: 'card-fetch', meta: deriveMeta(entry) }`  |
| `hf-id` with input | `{ kind: 'resolving', init }`                      |
| `hf-id` no input   | `{ kind: 'hf-input' }`                             |
| `import`           | `{ kind: 'import-confirm', bundle, pickedEp: ep }` |

> **Note:** the code adds three actions (`submit-hf-input`,
> `download-failed`, `all-downloaded`) and two `FailReason` variants
> (`cancelled`, `download-failed`) that emerged from implementation
> review. The original spec used a `__cancelled__` sentinel inside
> `card-fetch-failed.message` for cancel paths; the refactor makes
> cancel a first-class FailReason variant. The plan doc at
> `2026-05-11-embedder-download-dialog-plan.md` captures the
> motivation for each.

## Driver interface

The seam between dialog and platform. Container takes a `driver`
prop and calls into it from state-keyed effects. The dialog ships
the interface type plus a `stubDriver` (every method returns a
never-resolving Promise) for stories and tests. Real
implementations (per-platform) are followup work.

```ts
type DialogDriver = {
  fetchModelCard(
    source: { kind: 'catalog'; entry: CatalogEntry } | { kind: 'hf-id'; id: string },
  ): Promise<{ meta: ModelMeta; licenseText: string; licenseName: string }>
  resolveHfModel(id: string): Promise<{ meta: ModelMeta; files: string[] }>
  downloadFile(args: {
    url: string
    targetPath: string
    onProgress: (bytesReceived: number, bytesTotal: number) => void
  }): Promise<void>
  computeSha256(filePath: string): Promise<string>
  smokeTestEmbed(args: { modelDir: string; ep: ExecutionProvider }): Promise<void>
  persistInstall(args: { meta: ModelMeta; files: string[]; licenseText: string }): Promise<void>
  deletePartial(modelDir: string): Promise<void>
}
```

## Component API

```ts
type EmbedderDownloadDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  init: DialogInit
  driver: DialogDriver
  onResolve: (result: DialogResolution) => void
}

type EmbedderDownloadDialogViewProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: DialogState
  onAcceptLicense: () => void
  onDeclineLicense: () => void
  onSubmitHfInput: (id: string) => void
  onPickEp: (ep: ExecutionProvider) => void
  onConfirmImport: () => void
  onCancel: () => void
  onRetry: () => void
  onClose: () => void
}
```

The container mounts the reducer, wires effects to the driver,
and translates terminal states (`done`, `failed`) plus user
dismissals into a single `onResolve` call. Lifecycle invariant:
`onResolve` fires exactly once per open-to-close cycle. The View
is pure — takes a `state`, dispatches intents up, and uses
TypeScript narrowing on `state.kind` so per-body prop access
type-checks.

Host usage pattern matches JSONViewer's controlled-`open` shape:

```tsx
const [open, setOpen] = useState(false)
const driver = useEmbedderDownloadDriver()

<EmbedderDownloadDialog
  open={open}
  onOpenChange={setOpen}
  init={{ kind: 'catalog', entry: pickedCatalogEntry }}
  driver={driver}
  onResolve={(result) => {
    setOpen(false)
    /* host-specific routing on result.kind */
  }}
/>
```

## Visual structure

Inside `embedder-download-dialog.tsx`:

```
<EmbedderDownloadDialogView>
  └─ <Dialog open onOpenChange>
       └─ <DialogContent className="sm:max-w-[560px]">
            ├─ <DialogHeader>     state-keyed title, plus header-right Cancel when state.kind === 'downloading'
            ├─ <Body>             switch on state.kind, renders one of:
            │     HfInputBody, ResolvingBody, CardFetchBody, LicenseBody,
            │     EpPickerBody, ImportConfirmBody, DownloadingBody,
            │     VerifyingBody, DoneBody, FailedBody
            └─ <DialogFooter>     state-keyed button set per the table below
```

Footer shape per state:

| State            | Footer                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `hf-input`       | `[ Cancel ]  [ Resolve ]`                                                                                  |
| `resolving`      | `[ Cancel ]`                                                                                               |
| `card-fetch`     | `[ Cancel ]`                                                                                               |
| `license`        | `[ Decline ]  [ Accept & download ]`                                                                       |
| `ep-picker`      | `[ Cancel ]  [ Continue ]`                                                                                 |
| `import-confirm` | `[ Cancel ]  [ Import ]`                                                                                   |
| `downloading`    | (cancel lives in header; no footer)                                                                        |
| `verifying`      | (no actions)                                                                                               |
| `done`           | (auto-dismiss; no footer rendered)                                                                         |
| `failed`         | `reason.kind`-keyed: `card-fetch-failed` / `resolve-failed` → `[ Cancel ] [ Retry ]`; others → `[ Close ]` |

The Dialog primitive's `max-w-[calc(100%-2rem)]` from `_tmp/dialog.tsx`
gives phone the gutter-margin shape; a `sm:max-w-[560px]` override
at the `DialogContent` call site replaces the primitive's default
`sm:max-w-lg` (≈ 512px) to match the pattern doc's "560px-capped
centered shape." No `useTier()` — the dialog is uniformly modal at
every tier.

License-text scroll region uses a `<ScrollView>` capped via
`max-h-[50vh]` on web and a measured `flex-1` inside the
DialogContent's column on native. The Dialog primitive's portal
already grants a sized container.

Accessibility:

- `DialogTitle` carries the state-keyed title (`"Install MiniLM-L6
(lightweight)"`, `"⚠ Couldn't reach the model source"`, …),
  bound as `aria-labelledby` by the primitive.
- License-text region gets `aria-label="License text"` so screen
  readers can navigate into it.
- Escape closes via Dialog's default; container intercepts the
  resulting `onOpenChange(false)` and resolves as `cancelled` or
  `declined` depending on `state.kind`.
- `role="dialog"` (Dialog primitive default), not `alertdialog`.

## Storybook coverage

`embedder-download-dialog.stories.tsx` imports
`EmbedderDownloadDialogView` directly and renders one story per
state with hand-crafted state objects. Event handlers are `() => {}`
no-ops — stories don't drive transitions.

Story matrix:

| Story                   | State (abbreviated)                                                           |
| ----------------------- | ----------------------------------------------------------------------------- |
| `HfInput`               | `{ kind: 'hf-input' }`                                                        |
| `Resolving`             | `{ kind: 'resolving', init: { kind: 'hf-id', input: '…' } }`                  |
| `CardFetch`             | `{ kind: 'card-fetch', meta }`                                                |
| `License_Apache`        | `{ kind: 'license', meta, licenseText: APACHE_2, licenseName: 'Apache 2.0' }` |
| `License_NoLicense`     | same kind, `licenseName: ''`                                                  |
| `License_LongText`      | long license body — scroll-region overflow case                               |
| `EpPicker`              | `{ kind: 'ep-picker', meta, pickedEp: 'cpu' }`                                |
| `ImportConfirm`         | `{ kind: 'import-confirm', bundle, pickedEp: 'cpu' }`                         |
| `Downloading_Initial`   | first file at 0%, others waiting                                              |
| `Downloading_MidFlight` | pattern doc's 72% reference                                                   |
| `Downloading_Final`     | first two done, last in-flight                                                |
| `Verifying_AllPending`  | `verifyByFile: { all: 'pending' }`                                            |
| `Verifying_Partial`     | pattern doc's reference (first two `ok`, last `pending`)                      |
| `Done`                  | `{ kind: 'done', meta }`                                                      |
| `Failed_CardFetch`      | `card-fetch-failed` reason                                                    |
| `Failed_Resolve`        | `resolve-failed` reason (HF id only)                                          |
| `Failed_Validation`     | `validation-failed` reason (HF id only)                                       |
| `Failed_HashMismatch`   | `hash-mismatch` reason (pattern doc's reference)                              |
| `Failed_SmokeTest`      | `smoke-test-failed` reason (custom-import only)                               |
| `ThemeMatrix`           | per-theme triggers opening the View at `License_Apache` state                 |

20 stories. Sample fixtures (`sampleMeta`, `APACHE_2`,
`LONG_LICENSE`, `sampleBundle`) live at the top of the story file;
not extracted, since they're story-local.

`ThemeMatrix` follows the
[`alert-dialog.stories.tsx:158`](../../components/ui/alert-dialog.stories.tsx)
pattern: per-theme triggers via `dataSet={{ theme: t.id }}`. The
dialog content portals to the global root and reflects the
toolbar-selected theme, not the per-row one — same partial
coverage AlertDialog accepts. Per-row coverage paints the trigger
button's theme.

`dialog.stories.tsx` (primitive) carries the same ThemeMatrix
shape with a generic "Confirm action" dialog body.

Reducer coverage lives in
`embedder-download-dialog-machine.test.ts` (vitest), not in
stories — one test per `DialogAction × DialogState` transition
pair (~20 tests), invariant checks (terminal states resolve;
`cancel` from any state lands in `cancelled` or `failed`; `retry`
from `failed { card-fetch-failed }` returns to `card-fetch`), and
one test per `DialogInit.kind` for the initial-state factory.

No container story or container test — the container's
`onResolve` lifecycle invariant is reducer-driven, and the View
stories already paint every visual the container can produce.

## Scope boundary — driver implementations

Out of scope for this build, gated on per-consumer wiring:

- Electron-side filesystem driver (main-process IPC handlers for
  download / hash / install / delete) — needed for desktop
  consumers.
- Expo file-system driver (using `expo-file-system`) — needed for
  mobile consumers.
- `@huggingface/hub` integration for model-card fetch and file
  listing.
- SHA256 computation per platform (Web Crypto on web; Node
  `crypto` in Electron main; expo-file-system digest on native).
- Smoke-test embed integration (boots the picked EP, runs one
  embed, returns).

Each is followup work tracked against the consumer that needs it
first (Onboarding Step 4 lands first per
[`onboarding.md → Step 4 — Pick an embedder`](../ui/screens/onboarding/onboarding.md#step-4--pick-an-embedder)).

## Inventory implications

After this build:

- **Primitives — shipped** gains `Dialog`.
- **Compounds — shipped** gains `EmbedderDownloadDialog`.
- **Compounds — build-ready** empties out (the only entry was
  EmbedderDownloadDialog itself).

Inventory update lands in the same commit as the shipped code per
the `feedback_inventory_double_entry` recurring-oversight memory.

## Followups parked

- **License re-fetch caching within a session** — per pattern doc
  → Open items. The dialog re-fetches the license live on every
  open (no in-session cache). Optimization, not a correctness gap.
  Park until real signal.
- **Driver wiring per consumer** — Onboarding Step 4 first, then
  App Settings · Embedding models, then Story Settings · Memory
  · Switch embedder. Each is a separate task.
- **N-way merge for 3+ HF model collisions** — pattern doc covers
  two-side only. Out of scope here entirely.
