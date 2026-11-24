import { useLayoutEffect, useRef, type RefObject } from 'react'

// Layout, not passive: the commit that unmounts the reader (a switch, a leave) runs to
// completion before any promise continuation, so no settling callback reads it still mounted.
export function useAliveRef(): Readonly<RefObject<boolean>> {
  const aliveRef = useRef(false)
  useLayoutEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])
  return aliveRef
}
