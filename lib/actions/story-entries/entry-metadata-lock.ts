import { withKeyLock } from '../delta/key-lock'

/**
 * Serializes the read-then-decide of every ungated entry-metadata writer. Per ROW, not
 * per action: same-row writers under different action names are the pair that must not
 * interleave. Never call one of them from `run` — the lock is not reentrant, so the inner
 * call would await the outer's own promise and deadlock. It is the outermost lock: `run`
 * may dispatch through the runner, which takes its row locks inside; nothing holding a row
 * lock may take this one.
 */
export function withEntryMetadataLock<T>(
  branchId: string,
  id: string,
  run: () => Promise<T>,
): Promise<T> {
  return withKeyLock(`entryMetadata:${branchId}:${id}`, run)
}
