# UI components

`components/ui/` holds primitives: a `Button`, a `Dialog`, a `Textarea`. They say nothing about
what a delete button or a confirmation looks like, so every call site used to decide that again.
This catalog lists the patterns built on top of them. Before building one of these by hand, use the
component named here; if a new pattern repeats, add it.

Nothing enforces the catalog. It is the place to look, and the place to point at in a review.

## A modal that ends in Cancel plus one action

Use `shared/ActionModal.svelte`. A caller passes what the modal says and does; the shell owns the
rest:

- **Layout.** A header with the title and description and no close button: Cancel is the way out.
  Below it, one scroller holds the body and the two buttons, so the action is reached by reading
  down to it. The header stays pinned. Nothing inside scrolls on its own: an autosizing `Textarea`
  in the body drops its height cap and lets the modal scroll.
- **Phone.** Below 768px the modal is a bottom sheet with a handle. Only the handle drags; the
  content scrolls.
- **Buttons.** An outlined Cancel and the action, side by side on a phone and at the trailing edge
  on desktop. The action's icon turns into a spinner while it runs.
- **Ways out.** Cancel, Escape, a click outside and the handle (drag or tap) all go through one
  decision, `shared/actionModalClose.ts`, which has its own tests.
- **The busy lock.** While `busy`, no way out closes the modal or asks anything, unless
  `cancelWhileBusy` says Cancel stops the running action.

| Prop                       | For                                                                             |
| -------------------------- | ------------------------------------------------------------------------------- |
| `open` / `onCancel`        | `onCancel` runs when the user leaves without the action; it defaults to closing |
| `onClosed`                 | after the close transition, for a caller that unmounts the modal then           |
| `title` / `description`    | `description` is a string or a snippet                                          |
| `children`                 | the body; a confirmation whose description says it all has none                 |
| `headerExtra`              | a switch that changes what the body says, read before the body                  |
| `action`                   | `{ label, icon?, tone?, disabled?, onConfirm }`                                 |
| `busy`, `cancelWhileBusy`  | the busy lock                                                                   |
| `dirty`, `discardQuestion` | see below                                                                       |
| `cancelLabel`              | only when Cancel ends more than the modal: "Cancel import"                      |
| `titleIcon`                | only for a confirmation that warns, like the backup and restore ones            |
| `removal`                  | removing the thing the modal edits; see below                                   |
| `nested`                   | opened from inside another modal; see below                                     |
| `size`                     | `md` (the default) or `lg`                                                      |

### When to pass `dirty`

A modal asks before it is closed when it holds something that would be lost:

- a multi-line text field,
- more than one field to fill in,
- values that already existed and have been edited, or
- a result that is costly to produce again, such as a read import file.

A field is something the user fills in: text, or a choice the action saves. A toggle that only
shapes what the action does is not a field. So the only modal that never asks is one whose single
field is an empty, single-line one, like a branch name: retyping one word is cheap. Several short
fields count, because moving between them is exactly when a click lands outside the form.

`dirty` stays a boolean the caller computes, since only the caller knows what its fields are.
`discardQuestion` words the question for the case: "Discard your changes?" for edits, "Cancel this
import?" for an import.

### A click outside is Cancel

A click outside does exactly what Cancel would: close, ask, or nothing while busy. There is no
option to ignore it. Whatever an ignored click would protect is protected already, by the discard
question when there is something to lose, or by the busy lock while the action runs.

### Removing the thing the modal edits

`removal` puts a small red text button after the body, before Cancel and the action, so it
scrolls with the content and is read after what it would remove. It asks inside the modal before
running. Use it only to remove the thing the modal edits, never as a general third action.

### A modal inside another modal

`nested` makes the phone sheet a `vaul` nested sheet, which stacks on its parent's. `vaul` finds
the parent through Svelte context, so the nested modal must be rendered inside the parent modal's
content, not beside it.

### Anomaly handlers

A modal that interrupts a flow to resolve an exception, like the prompt-pack question during an
import, is not a step of the control that started the flow. Its title asks its own question, its
buttons say what they do to the larger flow ("Cancel import", "Import story"), and its action
carries no glyph of that control.

### `ModalActions` on its own

`shared/ModalActions.svelte` is the shell's footer. Reach for it alone only for a modal whose body
cannot live in the shell's one scroller.

### Not migrated yet

These end in Cancel plus an action but are still assembled by hand: `LorebookExportModal`,
`LorebookImportModal`, `LorebookVaultImportModal`, `ResummarizeModal`, `SyncModal`,
`VaultExportModal`, `STChatImportModal`, and in `vault/prompts/` `CreatePackDialog`,
`ExportIntoFolderDialog`, `ImportPreviewDialog`, `RefreshTemplatesDialog`, `TestVariablesModal`,
`UpdatePackDialog` and the pack deletion in `PromptPackList`. Move one onto the shell when you
are in it anyway.

These are not Cancel plus one action, and stay as they are: `TimelineAnomaliesModal` (a list with
Close), `TimelineReconciliationModal` (a multi-step wizard), the unsaved-changes question in
`PromptPackEditor` (three choices) and `RestoreCompleteDialog` (a status screen).

## Feature colours

Some features have a colour: Branch and Regenerate are amber, Checkpoint is blue, Delete is red.
`shared/featureColors.ts` holds one colour per feature for light themes and one for dark themes,
the same in every theme of a mode. Both the control that opens a feature's modal and the modal's
action read it, so they cannot drift apart.

- **A trigger** in the colour uses `text` and darkens one shade on hover with `hoverText`. A
  trigger muted until hovered, like an entry's delete button, uses `revealText`.
- **A modal's action** takes the trigger's tone, as `action.tone`. It is drawn by the `Button`
  variant `feature`: the label in the colour, on a 16% wash of it over the theme's background, with
  Cancel's border.
- **A trigger with no colour** gives its action the primary button, unless the action does
  something the user should see coming. Then the modal picks a tone named for what the action does,
  like `overwrite` for restoring a backup over the database.

Recognising the trigger's colour comes before the label's contrast against its wash. Some labels
fall below 4.5:1, light-theme amber and red most of all. Do not deepen a shade to fix that in one
place: the trigger and the action would stop matching. A change to the colours is a change to the
map.

Tones are named after their trigger or their effect. None is named `danger` or `destructive`: the
theme's `--destructive` red and `Button`'s `destructive` variant are louder, and stay out of this.
