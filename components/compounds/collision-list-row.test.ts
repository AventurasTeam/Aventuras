import { assertType, describe, it } from 'vitest'

import type { CollisionListRowProps } from './collision-list-row'

type Collision = CollisionListRowProps['collision']

const BASE = { otherName: 'Kael', onJumpToOther: () => {} }

// Pinned at typecheck: an unused @ts-expect-error fails `tsc`, so a loosened prop fails the build.
describe('CollisionListRowProps', () => {
  it('makes Resolve either act or say why it cannot', () => {
    assertType<Collision>({ ...BASE, onResolve: () => {} })
    assertType<Collision>({ ...BASE, resolveDisabledReason: 'Lands in Slice 4.2c' })
    // @ts-expect-error — an inert Resolve that never says why.
    assertType<Collision>({ ...BASE, onResolve: () => {}, resolveDisabled: true })
    // @ts-expect-error — Resolve can't both act and be inert.
    assertType<Collision>({ ...BASE, onResolve: () => {}, resolveDisabledReason: 'x' })
    // @ts-expect-error — Resolve must do one or the other.
    assertType<Collision>({ ...BASE })
  })
})
