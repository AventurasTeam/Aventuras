/**
 * Activity Tree
 *
 * Reading views over a turn's flat step list: the nesting, and which step is currently the
 * innermost one running.
 */

import type { ActivityNode, ActivityRow, ActivityStep } from './types'

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

/**
 * The outermost step this one sits under, or the step itself when it is already a root.
 *
 * The short form names the innermost step running, which on its own says "Model call 1"
 * without saying what that call is for. The root is the phase it belongs to.
 */
export function rootStep(steps: ActivityStep[], step: ActivityStep): ActivityStep {
  const byId = new Map(steps.map((s) => [s.id, s]))
  let current = step
  const seen = new Set<string>([step.id])
  while (current.parentId !== null) {
    const parent = byId.get(current.parentId)
    // A cycle cannot arise from correct recording, but the walk must still terminate.
    if (!parent || seen.has(parent.id)) break
    seen.add(parent.id)
    current = parent
  }
  return current
}

/** The forest in reading order, each step carrying its depth. */
export function flattenTree(nodes: ActivityNode[], level = 0): ActivityRow[] {
  const rows: ActivityRow[] = []
  for (const node of nodes) {
    rows.push({ step: node.step, level })
    rows.push(...flattenTree(node.children, level + 1))
  }
  return rows
}

/**
 * Failed steps whose failure a failed descendant already shows: a parent that failed because its
 * child did, carrying the child's reason or none of its own. Displaying both repeats one failure.
 * A parent with a reason of its own -- a request's "after 3 attempts" over its attempts -- is kept.
 */
export function failuresShownBelow(nodes: ActivityNode[]): Set<string> {
  const shown = new Set<string>()
  // The reasons of the failed steps beneath `node`, and of `node` itself when failed.
  const visit = (node: ActivityNode): (string | undefined)[] => {
    const below = node.children.flatMap(visit)
    const { step } = node
    if (step.status === 'failed' && below.length > 0) {
      if (!step.error || below.includes(step.error)) shown.add(step.id)
    }
    return step.status === 'failed' ? [...below, step.error] : below
  }
  nodes.forEach(visit)
  return shown
}

/** What lies beneath a step: a failure, or only failed attempts its request got past. */
export type FailureMark = 'failed' | 'recovered'

/**
 * Steps with a failed step somewhere beneath them, and which kind. A failed attempt whose request
 * has not failed -- it is retrying, or got there on a later attempt -- is recovered; any other
 * failure is a failure. A step with both beneath it is marked failed.
 */
export function failureMarks(nodes: ActivityNode[]): Map<string, FailureMark> {
  const marks = new Map<string, FailureMark>()
  const worse = (a: FailureMark | null, b: FailureMark | null): FailureMark | null =>
    a === 'failed' || b === 'failed' ? 'failed' : (a ?? b)
  const visit = (node: ActivityNode): FailureMark | null => {
    let below: FailureMark | null = null
    for (const child of node.children) {
      const own: FailureMark | null =
        child.step.status !== 'failed'
          ? null
          : child.step.attempt && node.step.status !== 'failed'
            ? 'recovered'
            : 'failed'
      below = worse(below, worse(own, visit(child)))
    }
    if (below) marks.set(node.step.id, below)
    return below
  }
  nodes.forEach(visit)
  return marks
}

/**
 * Steps with an LLM step beneath them. The marker belongs on the calls themselves, so a step
 * marked as one that turns out to contain them -- a request that needed several attempts -- is
 * a container and shows no marker of its own.
 */
export function stepsAboveLLMSteps(nodes: ActivityNode[]): Set<string> {
  const above = new Set<string>()
  const visit = (node: ActivityNode): boolean => {
    let llmBelow = false
    for (const child of node.children) {
      if (visit(child) || child.step.isLLM) llmBelow = true
    }
    if (llmBelow) above.add(node.step.id)
    return llmBelow
  }
  nodes.forEach(visit)
  return above
}
