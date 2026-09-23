import { describe, expect, it } from 'vitest'

import { compareToBaseline, compilerBailout } from './compiler-bailouts'

describe('compilerBailout', () => {
  it('passes a component the compiler can optimize', async () => {
    const source = `
      import { useState } from 'react'
      export function Counter() {
        const [n, setN] = useState(0)
        return <button onClick={() => setN(n + 1)}>{n}</button>
      }
    `
    expect(await compilerBailout(source, 'counter.tsx')).toBeNull()
  })

  it('reports a try/catch/finally in a handler, which builds skip silently', async () => {
    const source = `
      export function Save({ run }: { run: () => void }) {
        const onPress = () => {
          try { run() } catch { return } finally { console.log('done') }
        }
        return <button onClick={onPress}>Save</button>
      }
    `
    expect(await compilerBailout(source, 'save.tsx')).toMatch(/finalizer \('finally'\)/)
  })

  it('reports a ref written during render', async () => {
    const source = `
      import { useRef } from 'react'
      export function useLatest<T>(value: T) {
        const ref = useRef(value)
        ref.current = value
        return ref
      }
    `
    expect(await compilerBailout(source, 'use-latest.ts')).toMatch(/refs during render/)
  })

  it('parses a .ts file as TypeScript, not TSX', async () => {
    const source = `export const asNumber = (value: unknown) => <number>value\n`
    expect(await compilerBailout(source, 'as-number.ts')).toBeNull()
  })
})

describe('compareToBaseline', () => {
  it('flags a new bail-out and a baseline entry that now compiles', () => {
    expect(compareToBaseline(['a.tsx', 'c.tsx'], ['a.tsx', 'b.tsx'])).toEqual({
      added: ['c.tsx'],
      fixed: ['b.tsx'],
    })
  })

  it('is clean when the sweep matches the baseline', () => {
    expect(compareToBaseline(['a.tsx'], ['a.tsx'])).toEqual({ added: [], fixed: [] })
  })
})
