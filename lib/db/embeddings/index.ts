export type { VecTargetKind } from './vec-tables'
export {
  VEC_FAMILIES,
  ensureVecTables,
  ensureVecTablesSql,
  vecRowPk,
  vecTableName,
} from './vec-tables'
export type { VecWrite } from './ops'
export { deleteVecOps, packFloat32, upsertVecOps } from './ops'
export type { EmbeddedFieldRow } from './stale'
export { clearEmbeddingStaleOp, recomputeStaleOp } from './stale'
export { compositeText, sourceHash } from './source-hash'
