# No "harmless" id leaks — prune on disappearance

It's tempting to label leftover entries in an id-keyed collection
as "harmless because they aren't rendered" — `expandedIds`,
selection sets, scroll memory, etc. The leak **isn't** harmless
when the same id reappears later (Reset to defaults, undo,
reload-from-store), because the resurrected entry inherits the
stale state and silently breaks invariants downstream.

## Why

Aventuras `SuggestionCategoriesEditor` had `expandedIds: Set<string>`
retaining ghost ids after delete / clear. A Clear-then-Reset
re-introduces the SEED ids; the re-mounted row reads
`expanded={true}` from the stale set, the body renders inside an
overflow-hidden container that's still spring-growing from
estimated heights, the chevron animates open instantly — net
effect "chevron says open, body invisible." Looks like a desync
bug; was actually the leaked state.

## How to apply

When pruning is cheap (set / map keyed by id, you already iterate
the current id list in an effect), prune in the same pass.
Pattern:

```ts
setExpandedIds((prev) => {
  const next = new Set(prev)
  let changed = false
  for (const id of prev) {
    if (!currentIds.has(id)) {
      next.delete(id)
      changed = true
    }
  }
  // ... other mutations
  return changed ? next : prev // preserve reference if nothing actually changed
})
```

Bail-out when nothing changed (return `prev`) keeps the reference
stable so memo'd consumers don't re-render.

Doesn't apply when ids are guaranteed unique-forever (uuid / cuid in
append-only data) AND the data can't be restored — then leaks are
truly inert. But never assume "unique-forever" for ids the user
controls or that can be set from a constant seed.

Also exempt: a set whose job is to remember ids that left, like the
Chapter Timeline's judged chapters. Prune the state that would come
back with the id (the expanded id), not the memory of having seen it.

Related: [Reanimated 4 async SV write](./reanimated4-async-sv-write.md).
