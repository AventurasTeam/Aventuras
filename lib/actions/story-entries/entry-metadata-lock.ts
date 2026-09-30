import { withKeyLock } from '../delta/key-lock'

/**
 * Serializes ungated entry-metadata writers' read-then-decide per ROW: same-row writers under
 * different action names must not interleave. Not reentrant — never call one from `run`, it
 * deadlocks. Outermost lock: `run` may take the runner's row locks; no row-lock holder takes this.
 */
export function withEntryMetadataLock<T>(
  branchId: string,
  id: string,
  run: () => Promise<T>,
): Promise<T> {
  return withKeyLock(`entryMetadata:${branchId}:${id}`, run)
}
