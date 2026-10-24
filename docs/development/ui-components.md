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
- **Phone.** Below 768px a tool is a bottom sheet with a handle, and a command is a centred dialog
  inset from the screen's edges (see below). In a sheet, only the handle drags; the content
  scrolls.
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
| `action`                   | `{ label, icon?, tone?, disabled?, onConfirm }`                                 |
| `busy`, `cancelWhileBusy`  | the busy lock                                                                   |
| `dirty`, `discardQuestion` | see below                                                                       |
| `cancelLabel`              | only when Cancel ends more than the modal: "Cancel import"                      |
| `titleIcon`                | only for a risk beyond the action itself; see Wording                           |
| `removal`                  | removing the thing the modal edits; see below                                   |
| `size`                     | `md` (the default) or `lg`                                                      |
| `presentation`             | `sheet` for a tool; the default `dialog` for a command; see below               |

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

### Sheet or dialog

On a phone, a **tool** is a sheet and a **command** is a dialog. Pass `presentation="sheet"` for a
tool; a command keeps the default.

- **A tool** works on something the user opened it for: it edits an object's fields (the story
  edit dialog, Edit the recorded time, the anchor editor), picks from a list (Manual chapter), or
  creates a branch or a checkpoint.
- **A command** asks for a decision: it confirms an operation, warns before one, resolves a
  question the app raised in the middle of a flow, or takes a single value.

A bottom sheet reads as more of the page it rises from, so it suits controls tied to that content,
and it is dismissed casually. A centred dialog reads as "answer this". A confirmation in a sheet
looks like a tool, and a tool in a small centred box crowds its fields.

Create branch and Create checkpoint read as commands (a name, then an operation), but are sheets so
that a later sheet of entry actions on a phone can host their forms as steps.

**Sheets never stack.** A modal opened from inside another modal, such as a confirmation in
Settings or the pack question during a sync, is a dialog whatever its kind. A sheet on a sheet
leaves the user unsure which swipe closes what.

### Anomaly handlers

A modal that interrupts a flow to resolve an exception, like the prompt-pack question during an
import, is not a step of the control that started the flow. Its title asks its own question, its
buttons say what they do to the larger flow ("Cancel import", "Import story"), and its action
carries no glyph of that control.

### Focus and Enter

Mark a field `data-autofocus` when it is the first control that decides the action and it is a
single-line text field: a name to create, a model to add, a time to set. The shell focuses it on
opening, so a phone raises its keyboard. A sheet rises with the keyboard in one motion. A dialog
with a marked field sits near the top of a phone's screen, since a centred one would jump when the
keyboard shortens the screen; a long one loses height from the bottom, and its content scrolls. Mark nothing when the
first such control is a toggle, or when the modal edits a whole record whose fields the user may
each want or not: Edit story opens with no keyboard. iOS raises no keyboard for this focus, so
there it waits for a tap.

Enter in a single-line field moves to the next text field, with `enterkeyhint="next"`. In the
last one, a modal that creates or adds performs its action (`enterkeyhint="go"`). A modal that
edits existing values only drops the keyboard (`enterkeyhint="done"`): an edit is saved through the
on-screen button, never by a key under the thumb.

Ctrl+Enter (Cmd+Enter on a Mac) in any field of an action modal performs its action, unless the
action is disabled or running. The shell owns it, so a field's own Enter handler ignores Enter with
a modifier. A phone keyboard has no such key, so it cannot save by accident.

### Wording

The header is left-aligned at every width, since a title or description that wraps reads badly
centred. It holds only the title and a short description; a control, even a switch that changes
what the body says, goes at the top of the body. The body never repeats the title: "Entry 47 will
be deleted" under "Delete entry 47" says nothing.

- **Sentence case** for titles and buttons.
- **A command's title is a statement:** a verb, its object with an article, and the target when
  there is one: "Delete entry 47", "Create a checkpoint at entry 12". An anomaly handler's title is
  its question: "Which prompt pack should this story use?"
- **The description says what the title cannot,** a consequence or context, and never repeats it.
  No deletion says "This cannot be undone": none can be, and each says what is lost instead.
- **The action repeats the title's verb without the article,** "Create branch", "Delete all
  entries", and is never "Continue" or "OK".
- **The discard and removal questions name both outcomes:** "Keep editing" or "Discard", "Keep
  anchor" or "Delete anchor". Their buttons are the footer's pair: Outline to stay, and the
  `feature` variant in the `delete` tone to go.

- **A warning icon only where a confirmation warns of a risk beyond the action itself,** like a
  backup that carries API keys, or a restore that replaces the database and closes the app. The
  discard and removal questions carry none: they confirm what the user just chose, and their
  description says what is lost.

The backup and restore confirmations keep their own wording.

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

## Folding explanations

An explanation of how something works, which a reader needs once and then knows, is a
`shared/ExplanationFold`: a muted summary line ("How past checkpoints work", "What an anchor does")
that unfolds the text below it. It starts open, and whether the reader folded it is saved per
explanation, across stories and sessions, under the `id` it is given, which no other
explanation may share. A search for `ExplanationFold` finds them all.

In an action modal it goes in the body, above the fields, not in the header's description: the
header stays pinned, and an explanation the reader has read should not keep its height there. A
description is for what the reader needs every time.

Not every fold is one. A notice about this particular item, like the time edit's "This entry is a
fork point", opens again each time, since what it says changes with the item.

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
