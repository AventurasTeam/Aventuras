import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// The renderer and the preload declare NativeApi in separate tsconfigs, so neither
// compiler can see the other's copy: a method added to one side typechecks against
// a `window.native` that does not have it, and the call is undefined at runtime.
const RENDERER = 'types/native.d.ts'
const PRELOAD = 'electron/native/types.ts'

export function nativeApiBlock(src: string): string {
  const start = src.indexOf('export type NativeApi = {')
  const end = src.indexOf('\n}', start)
  return src.slice(start, end + 2).trim()
}

describe('the two NativeApi declarations stay in step', () => {
  it('extracts only the NativeApi block, not what follows it', () => {
    const block = nativeApiBlock(
      'export type NativeApi = {\n  a(): void\n}\n\ndeclare global {\n  x: 1\n}\n',
    )
    expect(block).toBe('export type NativeApi = {\n  a(): void\n}')
  })

  it('declares the same members on both sides of the bridge', () => {
    const renderer = nativeApiBlock(readFileSync(RENDERER, 'utf8'))
    const preload = nativeApiBlock(readFileSync(PRELOAD, 'utf8'))
    expect(renderer, `${RENDERER} and ${PRELOAD} have drifted apart`).toBe(preload)
  })
})
