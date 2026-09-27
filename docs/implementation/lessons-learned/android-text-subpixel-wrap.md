# Android wraps content-sized text into a clipped second line

A `Tag` in World's Settings tab showed `the` where its keyword was
`the courier`, with blank space before the `×`. Another showed
`fugitive` for `fugitive courier`. The node held the full text and
its frame was one line tall; Android had broken the line and clipped
the rest. Which chips failed depended on where they sat: the same
text rendered fine in the dev route and on the Identity tab, and a
re-render (Fast Refresh, a reload) could land the chip on a lucky
position and hide the bug.

## Why

A label sized exactly to its content leaves no slack, and on Android
the frame and the drawn line disagree by a fraction of a pixel.
Measured on a 2.625× emulator (RN 0.83), frames came out about 1 px
narrower than the text they held, so the last word — or the last
letter, `courie` / `r` — wrapped onto a line the frame cuts off.

Yoga has a guard for exactly this: text nodes never round their width
down, "as this could lead to unwanted text truncation"
(`yoga/algorithm/PixelGrid.cpp`). It applies only to nodes of type
`NodeType::Text`, and nothing in RN's renderer sets that type, so
paragraph frames round like any box. Which rounding step drops the
pixel wasn't traced. A chip's padding, border, gap, and the `×`'s
negative margin put its text at fractional pixel offsets, which is
why it fails by position.

**Diagnosing:** `onTextLayout` doesn't show what was drawn. It
reported one line for the clipped `the courier` and two lines for a
`courier` that drew whole. Trust a screenshot; use `onTextLayout`
only for the frame width it was computed at.

## Fix

`components/ui/tag.tsx` appends a hair space (U+200A) to a string
label on Android. Android lets trailing whitespace hang past the line
end, so it can't cause a wrap; it only widens the measured frame by
about 1 dp, which absorbs the mismatch. Web is untouched.

## How to apply

A single-line label whose width is its content (chips, pills,
badges) is at risk on Android; a label in a stretched or wider
container is not, since it has slack. When one shows a truncated
first word only on some rows, reach for the same trailing hair space
rather than a width tweak. `Tag` labels passed as elements, not
strings, don't get the fix yet — none has shown the bug.
