import type { Pipeline } from '../types'

const registry = new Map<string, Pipeline>()

export function registerPipeline(p: Pipeline): Pipeline {
  if (registry.has(p.kind)) throw new Error(`Pipeline kind already registered: ${p.kind}`)
  if (p.phases.length === 0) throw new Error(`Pipeline ${p.kind} has no phases`)
  // All phase names — including parallel-branch names — share one namespace, since
  // the orchestrator emits phase_start/phase_complete keyed by name.
  const names = new Set<string>()
  const claim = (name: string) => {
    if (names.has(name)) throw new Error(`Pipeline ${p.kind} has duplicate phase name: ${name}`)
    names.add(name)
  }
  for (const node of p.phases) {
    claim(node.name)
    if ('parallel' in node) for (const branch of node.parallel) claim(branch.name)
  }
  registry.set(p.kind, p)
  return p
}

export function getPipeline(kind: string): Pipeline {
  const p = registry.get(kind)
  if (!p) throw new Error(`No pipeline registered for kind: ${kind}`)
  return p
}

// Test seam — synthetic pipelines re-register each test.
export function __resetRegistry(): void {
  registry.clear()
}
