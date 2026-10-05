import type { Delta } from '@/lib/db'

import type { DbCtx } from '../../types'
import { reverseAndPruneDeltaRows } from '../reverse-replay'
import { selectReversalSet } from '../row-closure'

export async function reverseRows(rows: readonly Delta[], ctx: DbCtx): Promise<number> {
  return reverseAndPruneDeltaRows(
    await selectReversalSet(ctx, { branchId: 'b1', target: rows }),
    ctx,
    { keepRedoExact: false },
  )
}
