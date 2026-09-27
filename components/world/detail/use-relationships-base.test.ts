// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { RelationshipDraft, RelationshipLink } from '@/lib/world'

import { useRelationshipsBase } from './use-relationships-base'

const MIRA: RelationshipLink = {
  rowId: 'rel_1',
  otherId: 'char_mira',
  selfToOther: 'ally',
  otherToSelf: 'ally',
}
const VORNE: RelationshipLink = {
  rowId: 'rel_2',
  otherId: 'char_vorne',
  selfToOther: 'rival',
  otherToSelf: null,
}
const MIRA_DRAFT: RelationshipDraft = {
  cardKey: 'rel_1',
  otherId: 'char_mira',
  selfToOther: 'friend',
  otherToSelf: 'ally',
}
const MIRA_SAVED: RelationshipLink = {
  rowId: '',
  otherId: 'char_mira',
  selfToOther: 'friend',
  otherToSelf: 'ally',
}

function setup(dirty: boolean, links: readonly RelationshipLink[]) {
  return renderHook((props) => useRelationshipsBase(props.dirty, props.links), {
    initialProps: { dirty, links },
  })
}

afterEach(cleanup)

describe('useRelationshipsBase', () => {
  it('follows the store while the list is clean', () => {
    const hook = setup(false, [MIRA])
    expect(hook.result.current.base).toEqual([MIRA])
    hook.rerender({ dirty: false, links: [MIRA, VORNE] })
    expect(hook.result.current.base).toEqual([MIRA, VORNE])
  })

  it('freezes at the links of the render the list goes dirty in', () => {
    const hook = setup(false, [MIRA])
    hook.rerender({ dirty: true, links: [MIRA] })
    expect(hook.result.current.base).toEqual([MIRA])
    hook.rerender({ dirty: true, links: [MIRA, VORNE] })
    expect(hook.result.current.base).toEqual([MIRA])
  })

  it('follows the store again once the list is clean', () => {
    const hook = setup(true, [MIRA])
    hook.rerender({ dirty: true, links: [MIRA, VORNE] })
    hook.rerender({ dirty: false, links: [MIRA, VORNE] })
    expect(hook.result.current.base).toEqual([MIRA, VORNE])
    hook.rerender({ dirty: false, links: [VORNE] })
    expect(hook.result.current.base).toEqual([VORNE])
  })

  it('takes the list as saved while typing during the save keeps it dirty', () => {
    const hook = setup(true, [MIRA])
    act(() => hook.result.current.markSaved([MIRA_DRAFT]))
    expect(hook.result.current.base).toEqual([MIRA_SAVED])
    hook.rerender({ dirty: true, links: [MIRA, VORNE] })
    expect(hook.result.current.base).toEqual([MIRA_SAVED])
  })

  it('follows the store after a save once the list is clean', () => {
    const hook = setup(true, [MIRA])
    act(() => hook.result.current.markSaved([MIRA_DRAFT]))
    hook.rerender({ dirty: false, links: [MIRA, VORNE] })
    expect(hook.result.current.base).toEqual([MIRA, VORNE])
  })
})
