// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useDebouncedValue } from '@/hooks/use-debounced-value'

import { compiledInBuild } from './react-compiler'

const memoCache = vi.hoisted(() => ({ reads: 0 }))

vi.mock('react/compiler-runtime', async (importOriginal) => {
  const runtime = await importOriginal<{ c: (size: number) => unknown[] }>()
  return {
    ...runtime,
    c: (size: number) => {
      memoCache.reads += 1
      return runtime.c(size)
    },
  }
})

describe('compiledInBuild', () => {
  it.each(['app/index.tsx', 'components/ui/button.tsx', 'hooks/use-tier.ts', 'lib/toast/toast.ts'])(
    'takes the app source %s',
    (file) => {
      expect(compiledInBuild(file)).toBe(true)
    },
  )

  it.each([
    'components/ui/button.stories.tsx',
    'hooks/use-tier.test.tsx',
    'lib/db/__tests__/test-db.ts',
    'scripts/react-compiler.ts',
    'electron/db/service.ts',
    'e2e/flows/navigation.ts',
  ])('leaves %s alone', (file) => {
    expect(compiledInBuild(file)).toBe(false)
  })
})

describe('the unit project', () => {
  it('runs app hooks compiled, as the build ships them', () => {
    renderHook(() => useDebouncedValue('a', 10))
    expect(memoCache.reads).toBeGreaterThan(0)
  })
})
