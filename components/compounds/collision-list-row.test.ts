import { describe, expect, it } from 'vitest'

import type { CollisionListRowProps } from './collision-list-row'

type Collision = CollisionListRowProps['collision']

const BASE = { otherName: 'Kael', onJumpToOther: () => {} }

// Pinned at typecheck: an unused @ts-expect-error fails `tsc`, so a loosened prop fails the build.
describe('CollisionListRowProps', () => {
  it('makes Resolve either act or say why it cannot', () => {
    const acting: Collision = { ...BASE, onResolve: () => {} }
    const inert: Collision = { ...BASE, resolveDisabledReason: 'Lands in Slice 4.2c' }
    // @ts-expect-error — an inert Resolve that never says why.
    const unexplained: Collision = { ...BASE, onResolve: () => {}, resolveDisabled: true }
    // @ts-expect-error — Resolve can't both act and be inert.
    const both: Collision = { ...BASE, onResolve: () => {}, resolveDisabledReason: 'x' }
    // @ts-expect-error — Resolve must do one or the other.
    const neither: Collision = { ...BASE }
    expect([acting, inert, unexplained, both, neither]).toHaveLength(5)
  })
})
