import { describe, expect, it } from 'vitest'

import { packFloat32 } from '@/lib/db'

import { decodeVector } from './decode-vector'
import { VectorInvariantError } from './vector'

describe('decodeVector', () => {
  it('reads a stored blob back as the vector packed into it', () => {
    expect(Array.from(decodeVector(packFloat32(Float32Array.of(0.6, 0.8))))).toEqual([
      Math.fround(0.6),
      Math.fround(0.8),
    ])
  })

  it('throws a blob whose length is no whole number of floats into the vector-invariant family', () => {
    expect(() => decodeVector(new Uint8Array(3))).toThrow(VectorInvariantError)
    expect(() => decodeVector(new Uint8Array(3))).toThrow('Invalid vector blob length: 3')
  })
})
