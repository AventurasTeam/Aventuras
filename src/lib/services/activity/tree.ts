/**
 * Activity Tree
 *
 * Reading views over a turn's flat step list: the nesting, and which step is currently the
 * innermost one running.
 */

import type { ActivityNode, ActivityStep } from './types'

/**
 * Assemble the flat list into a forest, preserving append order among siblings.
 *
 * A step naming a parent that is not in the list is treated as a root rather than dropped:
 * the list is read while it is still being written, and a record missing a step is worse
 * than one whose nesting is shallower than it will be.
 */
export function buildTree(steps: ActivityStep[]): ActivityNode[] {
  const nodes = new Map<string, ActivityNode>()
  for (const step of steps) {
    nodes.set(step.id, { step, children: [] })
  }

  const roots: ActivityNode[] = []
  for (const step of steps) {
    const node = nodes.get(step.id)!
    const parent = step.parentId === null ? undefined : nodes.get(step.parentId)
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/**
 * The innermost step still running, or null when nothing is.
 *
 * Depth beats recency: while a chapter query runs, its retrieval ancestor is running too,
 * and naming the ancestor is what makes a forty-second wait unreadable. Among steps at the
 * same depth the latest to start wins, so concurrent branches report the freshest work.
 *
 * A step whose parent is missing counts as a root, matching `buildTree`.
 */
export function deepestRunningStep(steps: ActivityStep[]): ActivityStep | null {
  const byId = new Map(steps.map((s) => [s.id, s]))

  const depthOf = (step: ActivityStep): number => {
    let depth = 0
    let current = step
    const seen = new Set<string>([step.id])
    while (current.parentId !== null) {
      const parent = byId.get(current.parentId)
      // A cycle cannot arise from correct recording, but the list is appended to from
      // several places and an unbounded walk here would hang the render loop.
      if (!parent || seen.has(parent.id)) break
      seen.add(parent.id)
      current = parent
      depth++
    }
    return depth
  }

  let best: ActivityStep | null = null
  let bestDepth = -1
  for (const step of steps) {
    if (step.status !== 'running') continue
    const depth = depthOf(step)
    if (
      depth > bestDepth ||
      (depth === bestDepth && best !== null && step.startedAt >= best.startedAt)
    ) {
      best = step
      bestDepth = depth
    }
  }
  return best
}
