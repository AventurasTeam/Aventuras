# Storybook viewport → `useTier` is asynchronous

A play function's first tier-dependent assertion, made synchronously
after mount, can observe the desktop tier even when the story's
viewport control is set to phone.

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

Wrap any tier-dependent assertion in a play function in `waitFor`
rather than asserting immediately after mount or a user event —
give the resize event a chance to land before checking tier-derived
output.
