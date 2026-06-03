import { registerPipeline } from './registry'
import type { Pipeline, PhaseFn } from '../types'

// definePipeline validates + registers (validation-at-declaration per spec).
export function definePipeline(def: Pipeline): Pipeline {
  return registerPipeline(def)
}

// Terse phase helper — keeps phase bodies name-agnostic (the declaration owns names).
export function definePhase(name: string, run: PhaseFn): { name: string; run: PhaseFn } {
  return { name, run }
}
