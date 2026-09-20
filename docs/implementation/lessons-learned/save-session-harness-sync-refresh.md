# A save-session story harness must refresh its data synchronously

A Storybook harness for a Story Settings section that applies the
committed patch through plain `useState` makes correct section code
read as "edited mid-save": the save bar stays dirty and the section
never re-seeds from the saved row.

## Why

`StorySettingsSaveSessionProvider`
([`save-session.tsx`](../../../components/story-settings/save-session.tsx))
calls each dirty section's `getPatch` / `getColumnPatch` **twice** per
save — once to build the write, once after `onCommit` resolves — and
resets only the sections whose second read still equals what was
committed. A section whose data prop has not changed yet re-derives
the same draft it just sent, so the comparison is against a stale row
and the reset is skipped.

The real path has already refreshed by then: `saveStorySettingsSession`
awaits `rehydrateStories` before it returns, so the store row has moved
by the time `onCommit` resolves. A `useState` harness only _schedules_
its update, so the post-commit check runs against the old value and the
section looks edited.

## How to apply

Model the store, not the prop. Keep the harness row in a tiny external
store and read it through `useSyncExternalStore`, so a write inside
`onCommit` is visible to the very next read:

```tsx
const [cell] = useState(() => storyCell(initial))
const story = useSyncExternalStore(cell.subscribe, cell.get)
const commit = useCallback(
  async (patch: StorySettingsSessionPatch) => {
    await onCommit(patch)
    cell.set(applyPatch(cell.get(), patch))
  },
  [cell, onCommit],
)
```

Shipped shape in
[`about-panel.stories.tsx`](../../../components/story-settings/about-panel.stories.tsx)
→ `SaveReseedsFromTheSavedRow`. Surfaced in Slice 4.4.
