// `baseUnitsToTuple` walks the top tier one unit at a time, so render cost is
// linear in the resolved top-tier value. Measured on earth-gregorian with a
// cold cache: 1e11s ≈ 21ms, 1e12s ≈ 149ms, 1e15s ≈ 78s — the last freezes the
// reader on its first paint, before any UI can gate it. `worldTime` is
// classifier-written and otherwise unbounded above, so the stored value is
// capped here; 1e11s is ~3169 Gregorian years, far past any narrative span.
export const MAX_WORLD_TIME_SECONDS = 1e11
