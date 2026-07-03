import type { CalendarSystem, LeapCondition, Tier, TierTuple } from './calendar-schema'

const yearCostCache = new Map<string, number>()

export function __cacheSize(): number {
  return yearCostCache.size
}

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

export function tupleToBaseUnits(calendar: CalendarSystem, tuple: TierTuple): number {
  const { tiers } = calendar
  let total = 0
  const ctx: TierTuple = { ...tuple }
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i]
    const target = tuple[tier.name]
    for (let v = tier.startValue; v < target; v++) {
      ctx[tier.name] = v
      total += unitsInOneUnit(tiers, i, ctx)
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
    // epoch is linear in the year, which the per-year cost cache keeps cheap
    // across repeated calls.
    let value = tier.startValue
    for (;;) {
      out[tier.name] = value
      let cost: number
      if (i === 0) {
        const key = `${calendar.id}:${tier.name}:${value}`
        const cached = yearCostCache.get(key)
        if (cached === undefined) {
          cost = unitsInOneUnit(tiers, i, out)
          yearCostCache.set(key, cost)
        } else {
          cost = cached
        }
      } else {
        cost = unitsInOneUnit(tiers, i, out)
      }
      if (remaining < cost) break
      remaining -= cost
      value += 1
    }
  }
  return out
}

export function worldTimeToTuple(
  worldTime: number,
  calendar: CalendarSystem,
  origin: TierTuple,
): TierTuple {
  const originUnits = tupleToBaseUnits(calendar, origin)
  const elapsed = Math.floor(worldTime / calendar.secondsPerBaseUnit)
  return baseUnitsToTuple(calendar, originUnits + elapsed)
}
