import type { CalendarSystem, LeapCondition, Tier, TierTuple } from './calendar-schema'

const yearCostCache = new Map<string, number>()
const originUnitsCache = new Map<string, number>()
let originComputeCount = 0

// Test seam — exposes the per-year cost cache size for the cache-population test.
export function __cacheSize(): number {
  return yearCostCache.size
}

// Test seam — counts origin→base-unit conversions (memo misses) so a test can
// prove repeated same-origin calls reuse the memo rather than recompute.
export function __originComputeCount(): number {
  return originComputeCount
}

// Test seam — clears memo state so a test can assert from a clean baseline.
export function __resetCache(): void {
  yearCostCache.clear()
  originUnitsCache.clear()
  originComputeCount = 0
}

// Conditions stack into a SIGNED delta (not first-match): Gregorian composes
// +1 (÷4), −1 (÷100), +1 (÷400), so a ÷400 year re-includes what ÷100 excluded.
function evalLeap(against: number, conditions: LeapCondition[]): number {
  let delta = 0
  for (const c of conditions) {
    if ((against - (c.offset ?? 0)) % c.every === 0) delta += c.exclude ? -1 : 1
  }
  return delta
}

// How many of `tier` fit in one of its parent's units, given a context that
// fixes every higher tier's value.
function tierLength(tier: Tier, context: TierTuple, tiers: Tier[]): number {
  const r = tier.rollover
  if (r.kind === 'constant') return r.value
  if (r.kind === 'rule') return r.base + evalLeap(context[r.against], r.conditions)
  const idxTier = tiers.find((t) => t.name === r.indexedBy)!
  const base = r.values[context[r.indexedBy] - idxTier.startValue]
  // `atIndex` is the 1-based value of the indexing tier (February's month value),
  // not an array index, so it is compared against the live context value.
  if (r.leap && context[r.indexedBy] === r.leap.atIndex) {
    return base + evalLeap(context[r.leap.indexedBy], r.leap.conditions)
  }
  return base
}

// Highest valid value for `tierName` given a context tuple that fixes every
// coarser tier (e.g. day's max depends on month + leap-year context). Callers
// must validate top-down — the context values below `tierName` are unused,
// but values above it must already be confirmed valid for the range to mean
// anything (an invalid month makes "days in that month" undefined).
export function tierMax(calendar: CalendarSystem, tierName: string, context: TierTuple): number {
  const tier = calendar.tiers.find((t) => t.name === tierName)
  if (!tier) throw new Error(`Unknown tier: ${tierName}`)
  return tier.startValue + tierLength(tier, context, calendar.tiers) - 1
}

function hasVariableBelow(tiers: Tier[], i: number): boolean {
  for (let j = i + 1; j < tiers.length; j++) {
    if (tiers[j].rollover.kind !== 'constant') return true
  }
  return false
}

// Base units in one complete unit of tier `i`. A product would be wrong whenever
// a variable tier (e.g. days-in-month) sits below a constant one (months/year):
// a year is the SUM of twelve variable months, not twelve times any single one.
// So we multiply through blocks of identical-length children and only sum where
// a child's own length varies.
function unitsInOneUnit(tiers: Tier[], i: number, context: TierTuple): number {
  if (i === tiers.length - 1) return 1
  const child = tiers[i + 1]
  const count = tierLength(child, context, tiers)
  if (!hasVariableBelow(tiers, i + 1)) {
    const ctx: TierTuple = { ...context, [child.name]: child.startValue }
    return count * unitsInOneUnit(tiers, i + 1, ctx)
  }
  let total = 0
  const ctx: TierTuple = { ...context }
  for (let c = child.startValue; c < child.startValue + count; c++) {
    ctx[child.name] = c
    total += unitsInOneUnit(tiers, i + 1, ctx)
  }
  return total
}

// Base units in one whole top-tier unit (e.g. a year), memoized per value.
// Both directions of the conversion walk the top tier one unit at a time, so
// caching here keeps repeated calls off the O(units-in-a-year) recomputation.
function cachedTopTierCost(calendar: CalendarSystem, value: number): number {
  const { tiers } = calendar
  const top = tiers[0]
  const key = `${calendar.id}:${top.name}:${value}`
  const cached = yearCostCache.get(key)
  if (cached !== undefined) return cached
  const cost = unitsInOneUnit(tiers, 0, { [top.name]: value })
  yearCostCache.set(key, cost)
  return cost
}

export function tupleToBaseUnits(calendar: CalendarSystem, tuple: TierTuple): number {
  const { tiers } = calendar
  let total = 0
  const ctx: TierTuple = { ...tuple }
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]
    const target = tuple[tier.name]
    for (let v = tier.startValue; v < target; v++) {
      ctx[tier.name] = v
      total += i === 0 ? cachedTopTierCost(calendar, v) : unitsInOneUnit(tiers, i, ctx)
    }
    ctx[tier.name] = target
  }
  return total
}

export function baseUnitsToTuple(calendar: CalendarSystem, baseUnits: number): TierTuple {
  const { tiers } = calendar
  const out: TierTuple = {}
  let remaining = baseUnits
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]
    if (i === tiers.length - 1) {
      out[tier.name] = tier.startValue + remaining
      break
    }
    // O(target - startValue) for the top tier: counting up from the calendar
    // epoch is linear in the year, bounded by the per-year cost cache.
    let value = tier.startValue
    for (;;) {
      out[tier.name] = value
      const cost = i === 0 ? cachedTopTierCost(calendar, value) : unitsInOneUnit(tiers, i, out)
      // A rule/table tier can legitimately compute a zero-length unit (e.g. a
      // `rule` base of 1 with an always-matching `exclude`), which would make
      // `remaining -= cost` a no-op and spin this loop forever. Stop counting up
      // once a unit costs nothing.
      if (remaining < cost || cost <= 0) break
      remaining -= cost
      value += 1
    }
  }
  return out
}

// The origin (worldTimeOrigin) is invariant across nearly every call for a given
// story, so its base-unit conversion is memoized to avoid re-walking the epoch.
function cachedOriginUnits(calendar: CalendarSystem, origin: TierTuple): number {
  let key = calendar.id
  for (const tier of calendar.tiers) key += `:${origin[tier.name]}`
  const cached = originUnitsCache.get(key)
  if (cached !== undefined) return cached
  originComputeCount += 1
  const units = tupleToBaseUnits(calendar, origin)
  originUnitsCache.set(key, units)
  return units
}

export function worldTimeToTuple(
  worldTime: number,
  calendar: CalendarSystem,
  origin: TierTuple,
): TierTuple {
  const elapsed = Math.floor(worldTime / calendar.secondsPerBaseUnit)
  return baseUnitsToTuple(calendar, cachedOriginUnits(calendar, origin) + elapsed)
}
