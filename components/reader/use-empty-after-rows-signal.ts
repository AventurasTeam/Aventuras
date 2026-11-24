import { useEffect, useRef } from 'react'

import { logger } from '@/lib/diagnostics'

// A switch's empty-paint signal on device: the empty placeholder after rows, which
// otherwise only a rollback of every entry shows.
export function useEmptyAfterRowsSignal(
  branchId: string,
  hydrationSucceeded: boolean,
  rowCount: number,
): void {
  const hadRowsRef = useRef(false)
  useEffect(() => {
    if (!hydrationSucceeded) return
    if (rowCount > 0) hadRowsRef.current = true
    else if (hadRowsRef.current) logger.debug('reader.empty_after_rows', { branchId })
  }, [branchId, hydrationSucceeded, rowCount])
}
