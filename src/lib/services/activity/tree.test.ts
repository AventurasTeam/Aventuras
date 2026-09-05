import { describe, it, expect } from 'vitest'
import { buildTree, deepestRunningStep } from './tree'
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
