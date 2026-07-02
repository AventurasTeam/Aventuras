import type { Liquid } from 'liquidjs'

import { createEngine } from './engine'
import type { IncludeViolation, Pack } from './types'
import { validatePackIncludes } from './validate-includes'

export class PackLoadError extends Error {
  readonly violations: IncludeViolation[]
  constructor(violations: IncludeViolation[]) {
    super(`pack failed include validation: ${violations.length} violation(s)`)
    this.name = 'PackLoadError'
    this.violations = violations
  }
}

export type LoadedPack = {
  pack: Pack
  engine: Liquid
}

export function loadPack(pack: Pack): LoadedPack {
  const violations = validatePackIncludes(pack)
  if (violations.length > 0) throw new PackLoadError(violations)
  return { pack, engine: createEngine(pack) }
}
