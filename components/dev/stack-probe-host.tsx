import { useEffect } from 'react'

import { useReplaceStoryStack, type ReplaceStoryStack } from '@/hooks/use-replace-story-stack'

type ProbeGlobal = { __aventurasStackProbe?: ReplaceStoryStack }

/** Dev only: installs `globalThis.__aventurasStackProbe(branchId) → boolean` from the root host's position. */
export function StackProbeHost(): null {
  const replaceStack = useReplaceStoryStack()
  useEffect(() => {
    const probeGlobal = globalThis as ProbeGlobal
    probeGlobal.__aventurasStackProbe = replaceStack
    return () => {
      if (probeGlobal.__aventurasStackProbe === replaceStack)
        delete probeGlobal.__aventurasStackProbe
    }
  }, [replaceStack])
  return null
}
