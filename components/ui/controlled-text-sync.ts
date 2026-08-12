import type { ControlledTextSyncArgs, ControlledTextSyncResult } from './controlled-text-sync-types'

// Web passthrough. React DOM applies controlled values synchronously, so the
// caret survives the round-trip; only native needs the shim in the .native
// variant.
export function useControlledTextSync({
  value,
  defaultValue,
  onChange,
}: ControlledTextSyncArgs): ControlledTextSyncResult {
  return { hostRef: undefined, fieldProps: { value, defaultValue, onChange } }
}
