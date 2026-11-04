# Storybook viewport → `useTier` is asynchronous

A story's first commit can take the tier of the viewport before it,
since RN-Web's `Dimensions` lags a viewport change. The Storybook
preview now syncs it before each story; a play that resizes the
window itself still has to wait.

## Why

`@storybook/addon-vitest` sets the iframe's viewport before the story
mounts, but RN-Web's `Dimensions` (which `useWindowDimensions`, and
therefore [`useTier`](../../../hooks/use-tier.ts), reads from) caches
its first read and only updates on a later `resize` event. The story
mounts, reads the stale cached width, and renders at the desktop tier
for at least one commit before the resize event lands and `useTier`
re-renders at the correct tier.

Found in Slice 4.1: the World review pill's phone story asserted
phone-only copy (`⚠ 3`) synchronously after render and intermittently
saw the desktop copy instead.

## How to apply

`.storybook/preview.tsx` now fires `visualViewport`'s resize event in
a global `beforeEach` whenever `Dimensions` and the viewport disagree
on the tier, so a story's first commit reads its own viewport. It
holds in both directions: desktop to phone, and phone to desktop or
a story run alone with `-t`, where the page starts at a size of its
own. `FirstCommitTakesTheViewportTier` and the story before it in
`components/shells/screen-shell.stories.tsx` pin it.

A play that changes the viewport itself, as
`chapter-popover.stories.tsx`'s `withWindowSize` does, gets no such
sync: wait for the tier there (`waitFor`, or a tier probe) before
asserting on tier-derived output.
