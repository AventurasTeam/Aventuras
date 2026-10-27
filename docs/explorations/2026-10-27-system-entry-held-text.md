# System entry held text and details

A system entry now shows the turn's text it keeps, as a clamped quote
with a copy button and a line saying what Dismiss and a Send do to it,
and its failure detail moves behind a collapsed `Details` disclosure
under the buttons. Designed 2026-10-27; closes the followup "Seeing a
failure entry's held input" and the triage item "System entries show
their detail inline, with no `View details`".

## Why

A failure entry carries the turn's text in
`metadata.systemFailure.submission`, the only copy left once the run's
`user_action` was reversed, and no card shows it. A Send supersedes that
text, so the user decides whether to keep it at the moment they start
typing something else, without being able to read it. The only way to
see it was Dismiss, which destroys the entry and its `Retry`. The held
entry's copy said "Your text is kept on this entry" about text nobody
could see.

## Ground truth that shaped it

- **More entries carry the text than the followup named.**
  `writeTurnFailure` writes the submission on every turn failure, the
  embed row and the broken-reference rows included; pass entries carry
  it per the custody rules. Read from the write paths, not run.
- **`View details` was canon without code.** The failure table gave it
  to nine rows and the wireframe drew it; `EntryCard` rendered every
  system entry's `detail` as an inline muted line, with no button. A
  quote would be a second block in that same spot, so the two were one
  layout question.
- **The stored text is what Dismiss restores.** It is the wrapped text
  (`lib/composer-wrap`), handed back verbatim under `Free`
  (`handBackSubmission`).
- **A Send drops the entry before it runs** (`runSubmit`), on every
  outcome but a cancel during the owed pass, which puts it back. A Send
  refused held writes its own text.
- **The card can't reach the clipboard on native.** It renders in the
  reader document's WebView, where actions request and native chrome
  executes. `JSONBlock` writes `navigator.clipboard` on web and
  `expo-clipboard` on native, with no feedback.
- **The button row doesn't wrap** (`entry-card.tsx`), and four small
  buttons are tight on a phone.
- **The detail isn't uniform.** Most kinds store the log's English
  line, internal ids included; the blocked-by-another-operation detail
  is translated, written for the user.

## Decisions

**The detail is for a glance, collapsed in the card.** Rejected: _a
Dialog or Sheet_, a modal for one line of text; _a link into the
Diagnostics per-turn inspector_, which needs a `runId` on the entry and
is empty with diagnostics off. A copy button covers the bug report.

**The held text is always visible, clamped to two lines.** Rejected:
_its own toggle_, which hides the one thing the entry guards from the
user who doesn't think to look; _inside the detail disclosure_, which
files the user's writing under diagnostics.

**The held text gets a copy button; Dismiss stays the hand-back.**
Rejected: _read only_, since selecting text in a card is fiddly on a
phone; _a Put back action that keeps the entry_, the double run canon
rules out (a draft copy beside a standing `Retry`).

**Plain text, as in the input box.** The quote shows the stored text
unrendered, Think mode's asterisks included: what Dismiss puts back.

**`Details` sits under the buttons.** Opening it never moves the
buttons, and the row keeps three buttons at most. Rejected: _a button
in the row_ (canon's table), which pushes the buttons down on open and
makes four-button rows; _a toggle in the top line_, which pushes the
quote and buttons down too.

**The embed row joins the disclosure**, one rule for every system
entry; canon gave no reason for its inline detail.

**The detail may repeat what the content quotes.** It is report
material, and collapsed it no longer shows twice.

## The design

Canonical in
[`entry-card.md → System entry`](../ui/patterns/entry-card.md#system-entry)
(the quote, the custody line, the disclosure, copy, reveal on open, the
props) and
[`reader-composer.md → Transient pipeline failures`](../ui/screens/reader-composer/reader-composer.md#transient-pipeline-failures--system-entries-in-chat)
(the dropped `View details`, the custody line's wording, the trimmed
held and notice copy, in
[Custody of the turn's text](../ui/screens/reader-composer/reader-composer.md#custody-of-the-turns-text)).
The copy action crosses the
[bridge contract](../ui/patterns/reader-document.md#bridge-contract).

## Adversarial pass

- **Corrected in session**: the design first had the host write the
  clipboard through `expo-clipboard`'s web build "the way `JSONBlock`
  does"; `JSONBlock` uses `navigator.clipboard` on web. Canon names no
  API, only that the host writes and toasts.
- **The gate split** said `disabled` gates the system-entry buttons;
  the copy buttons and both toggles change nothing, so they stay live.
- **Plain text means a text node**, never the markdown pipeline the
  content goes through, so a `<b>` the user typed stays literal.
- **The clamp follows width**: a reflow can make a quote overflow or
  stop, and `Show all` follows it.
- **Copy, then Retry** leaves the text in both the draft and a resent
  turn: a duplicate the user made, accepted.
- **Dismiss over an occupied draft** still drops the text with a toast;
  the custody line says "if it's empty", and copy now precedes it.
- **The reveal** is a programmatic scroll after a tap, so it never
  lands mid-gesture; collapsing moves nothing.
- **Holds**: translation (the submission is the composer's text in the
  user's language, shown as typed); undo (a system entry has no create
  delta); a restored entry keeps its metadata, so its quote.
- **Implementation cost**: `retrieval-embed-failure.spec.ts` asserts
  the embed detail visible and needs the disclosure opened; the
  `memoryHeld` locator keys the merged copy.
- **Assumed**: `navigator.clipboard` works in Electron's renderer, as
  `JSONBlock` relies on; a failed write toasts.

## Integration plan

- `ui/patterns/entry-card.md`: the system-only props (`heldText`,
  `onCopy`); per-kind table rows for the quote and the disclosure; a
  `## System entry` section; the gate split's carve-out; the Storybook
  list.
- `ui/screens/reader-composer/reader-composer.md`: `View details`
  dropped from the failure table, a sentence under it; the embed
  paragraph; a Custody paragraph and its held-entry wording; the reveal
  among the reader's scroll writes, beside the editor's.
- `ui/screens/reader-composer/reader-composer.html`: the quote, the
  custody line and the `Details` toggle on the error entry; every
  variant loses its details button; controls for held text, a long
  text and details open.
- `ui/patterns/reader-document.md → Bridge contract`: the copy action.
- `ui/patterns/toast.md → Used by`: the copy confirmation on the reader.
- `memory/model-management.md`: the embed detail behind the disclosure.
- `data-model.md → Entry metadata shape`: `detail` and `submission`
  comments name where they show.
- `followups.md`: "Seeing a failure entry's held input" replaced by
  "Implement held text and the details disclosure".
- `implementation/triage.md`: the `View details` item removed; the
  window-copy item loses its doubled-message bullet.
