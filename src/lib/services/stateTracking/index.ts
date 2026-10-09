export {
  TRACKED_ENTITY_TYPES,
  canonicalId,
  cloneState,
  rowsOf,
  type TrackedRow,
  type TrackedState,
} from './state'
export { planReversal, type ReversalInput, type ReversalOp, type ReversalPlan } from './reverse'
export { fromWorldStateDelta } from './legacy'
export {
  isContinuous,
  lastCompletedEntry,
  lastHeaderOnLine,
  resolveRun,
  type AnchorCandidate,
  type LineEntry,
  type RunQuery,
  type RunRefusal,
  type RunResult,
} from './runs'
export { RECORD_COLUMNS, recordToRow, rowToRecord } from './rows'
export { changeRecord, changedFields, diffStates, type RecordContext } from './record'
export { describeChange, refusalMessage } from './describe'
