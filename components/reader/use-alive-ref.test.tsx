// @vitest-environment jsdom
import { cleanup, render, renderHook } from '@testing-library/react'
import { StrictMode, useLayoutEffect, type MutableRefObject } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { useAliveRef } from './use-alive-ref'

afterEach(cleanup)

describe('useAliveRef', () => {
  it('is true while the component is mounted', () => {
    const { result } = renderHook(() => useAliveRef())
    expect(result.current.current).toBe(true)
  })

  it('is false once the component unmounts', () => {
    const { result, unmount } = renderHook(() => useAliveRef())
    unmount()
    expect(result.current.current).toBe(false)
  })

  it('is true again after StrictMode mounts, unmounts and remounts the effect', () => {
    const { result } = renderHook(() => useAliveRef(), { wrapper: StrictMode })
    expect(result.current.current).toBe(true)
  })

  it('is already false when a child unmounts in the same commit', () => {
    const seen: boolean[] = []
    function Probe({ aliveRef }: { aliveRef: MutableRefObject<boolean> }) {
      useLayoutEffect(
        () => () => {
          seen.push(aliveRef.current)
        },
        [aliveRef],
      )
      return null
    }
    function Host() {
      const aliveRef = useAliveRef()
      return <Probe aliveRef={aliveRef} />
    }
    const { unmount } = render(<Host />)
    unmount()
    expect(seen).toEqual([false])
  })
})
