import { describe, it, expect } from 'vitest'
import {
  buildTree,
  deepestRunningStep,
  failuresShownBelow,
  stepsAboveFailures,
  flattenTree,
  rootStep,
} from './tree'
import type { ActivityStep } from './types'

function step(partial: Partial<ActivityStep> & { id: string }): ActivityStep {
  return {
    parentId: null,
    label: partial.id,
    isLLM: false,
    status: 'done',
    startedAt: 0,
    ...partial,
  }
}

describe('buildTree', () => {
  it('nests a child under its parent', () => {
    const tree = buildTree([
      step({ id: 'retrieval' }),
      step({ id: 'query', parentId: 'retrieval' }),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0].step.id).toBe('retrieval')
    expect(tree[0].children.map((c) => c.step.id)).toEqual(['query'])
  })

  it('keeps concurrent siblings in append order with their own times', () => {
    const tree = buildTree([
      step({ id: 'retrieval' }),
      step({ id: 'worldstate', parentId: 'retrieval', startedAt: 10, endedAt: 40 }),
      step({ id: 'lorebook', parentId: 'retrieval', startedAt: 12, endedAt: 38 }),
    ])

    const children = tree[0].children
    expect(children.map((c) => c.step.id)).toEqual(['worldstate', 'lorebook'])
    // Overlapping, not serialised.
    expect(children[1].step.startedAt).toBeLessThan(children[0].step.endedAt!)
  })

  it('treats a step whose parent is absent as a root rather than dropping it', () => {
    const tree = buildTree([step({ id: 'orphan', parentId: 'never-appended' })])

    expect(tree.map((n) => n.step.id)).toEqual(['orphan'])
  })

  it('nests a child appended before its parent', () => {
    const tree = buildTree([
      step({ id: 'query', parentId: 'retrieval' }),
      step({ id: 'retrieval' }),
    ])

    expect(tree.map((n) => n.step.id)).toEqual(['retrieval'])
    expect(tree[0].children.map((c) => c.step.id)).toEqual(['query'])
  })

  it('keeps an unclosed step in the tree', () => {
    const tree = buildTree([step({ id: 'retrieval', status: 'running' })])

    expect(tree[0].step.status).toBe('running')
    expect(tree[0].step.endedAt).toBeUndefined()
  })
})

describe('deepestRunningStep', () => {
  it('returns null when nothing is running', () => {
    expect(deepestRunningStep([step({ id: 'a' }), step({ id: 'b' })])).toBeNull()
  })

  it('returns the only running step', () => {
    const found = deepestRunningStep([step({ id: 'a' }), step({ id: 'b', status: 'running' })])

    expect(found?.id).toBe('b')
  })

  it('prefers the deepest step over its running ancestor', () => {
    const found = deepestRunningStep([
      step({ id: 'retrieval', status: 'running' }),
      step({ id: 'agentic', parentId: 'retrieval', status: 'running' }),
      step({ id: 'query', parentId: 'agentic', status: 'running' }),
    ])

    expect(found?.id).toBe('query')
  })

  it('picks the most recently started among concurrent steps at the same depth', () => {
    const found = deepestRunningStep([
      step({ id: 'retrieval', status: 'running' }),
      step({ id: 'worldstate', parentId: 'retrieval', status: 'running', startedAt: 10 }),
      step({ id: 'lorebook', parentId: 'retrieval', status: 'running', startedAt: 20 }),
    ])

    expect(found?.id).toBe('lorebook')
  })

  it('ignores finished steps deeper than the running one', () => {
    const found = deepestRunningStep([
      step({ id: 'retrieval', status: 'running' }),
      step({ id: 'query', parentId: 'retrieval', status: 'done' }),
    ])

    expect(found?.id).toBe('retrieval')
  })

  it('terminates on a parent cycle', () => {
    const found = deepestRunningStep([
      step({ id: 'a', parentId: 'b', status: 'running' }),
      step({ id: 'b', parentId: 'a', status: 'running' }),
    ])

    expect(found).not.toBeNull()
  })
})

describe('flattenTree', () => {
  it('returns the forest in reading order with each step at its depth', () => {
    const rows = flattenTree(
      buildTree([
        step({ id: 'retrieval' }),
        step({ id: 'agent', parentId: 'retrieval' }),
        step({ id: 'call-1', parentId: 'agent' }),
        step({ id: 'grep', parentId: 'call-1' }),
        step({ id: 'narrative' }),
      ]),
    )

    expect(rows.map((r) => [r.step.id, r.level])).toEqual([
      ['retrieval', 0],
      ['agent', 1],
      ['call-1', 2],
      ['grep', 3],
      ['narrative', 0],
    ])
  })

  it('keeps concurrent siblings adjacent at the same depth', () => {
    const rows = flattenTree(
      buildTree([
        step({ id: 'retrieval' }),
        step({ id: 'worldstate', parentId: 'retrieval' }),
        step({ id: 'lorebook', parentId: 'retrieval' }),
      ]),
    )

    expect(rows.map((r) => r.step.id)).toEqual(['retrieval', 'worldstate', 'lorebook'])
    expect(rows.slice(1).every((r) => r.level === 1)).toBe(true)
  })

  it('is empty for an empty forest', () => {
    expect(flattenTree([])).toEqual([])
  })
})

describe('rootStep', () => {
  const steps = [
    step({ id: 'retrieval' }),
    step({ id: 'memory', parentId: 'retrieval' }),
    step({ id: 'agent', parentId: 'memory' }),
    step({ id: 'call-1', parentId: 'agent' }),
    step({ id: 'narrative' }),
  ]

  it('walks a nested step up to the phase it belongs to', () => {
    expect(rootStep(steps, steps[3]).id).toBe('retrieval')
  })

  it('returns a root step unchanged', () => {
    expect(rootStep(steps, steps[4]).id).toBe('narrative')
  })

  it('stops at the outermost step it can reach when a parent is missing', () => {
    const orphaned = [step({ id: 'child', parentId: 'never-appended' })]

    expect(rootStep(orphaned, orphaned[0]).id).toBe('child')
  })

  it('terminates on a parent cycle', () => {
    const cyclic = [step({ id: 'a', parentId: 'b' }), step({ id: 'b', parentId: 'a' })]

    expect(rootStep(cyclic, cyclic[0])).toBeDefined()
  })
})

describe('failuresShownBelow', () => {
  const failed = (id: string, parentId: string | null, error?: string) =>
    step({ id, parentId, status: 'failed', error })

  it('marks a parent that failed with the same reason as its child', () => {
    const nodes = buildTree([failed('p', null, '401 · bad key'), failed('c', 'p', '401 · bad key')])
    expect([...failuresShownBelow(nodes)]).toEqual(['p'])
  })

  it('marks a failed parent with no reason of its own', () => {
    const nodes = buildTree([failed('p', null), failed('c', 'p', 'boom')])
    expect([...failuresShownBelow(nodes)]).toEqual(['p'])
  })

  it('keeps a parent whose reason says more than its children', () => {
    const nodes = buildTree([
      failed('req', null, '429 · limited (after 3 attempts)'),
      failed('a1', 'req', '429 · limited'),
    ])
    expect(failuresShownBelow(nodes).size).toBe(0)
  })

  it('reaches through a finished middle step to a failure deeper down', () => {
    const nodes = buildTree([
      failed('p', null, 'boom'),
      step({ id: 'm', parentId: 'p' }),
      failed('c', 'm', 'boom'),
    ])
    expect([...failuresShownBelow(nodes)]).toEqual(['p'])
  })

  it('leaves a failed step with no failed descendants alone', () => {
    const nodes = buildTree([failed('p', null, 'boom'), step({ id: 'c', parentId: 'p' })])
    expect(failuresShownBelow(nodes).size).toBe(0)
  })
})

describe('stepsAboveFailures', () => {
  it('marks every ancestor of a failed step, finished or not', () => {
    const nodes = buildTree([
      step({ id: 'retrieval' }),
      step({ id: 'world', parentId: 'retrieval' }),
      step({ id: 'tier3', parentId: 'world', status: 'failed', error: 'boom' }),
      step({ id: 'lorebook', parentId: 'retrieval' }),
    ])
    expect([...stepsAboveFailures(nodes)].sort()).toEqual(['retrieval', 'world'])
  })

  it('marks nothing when nothing failed', () => {
    expect(
      stepsAboveFailures(buildTree([step({ id: 'a' }), step({ id: 'b', parentId: 'a' })])).size,
    ).toBe(0)
  })
})
