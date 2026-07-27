export type { VecTargetKind } from './vec-tables'
export {
  VEC_FAMILIES,
  deleteBranchModelVecOps,
  deleteBranchVecOps,
  ensureVecTables,
  ensureVecTablesSql,
  familyTablesFor,
  isVecFamilyTable,
  vecRowPk,
  vecTableName,
} from './vec-tables'
export type { VecWrite } from './ops'
export { deleteVecOps, packFloat32, upsertVecOps } from './ops'
export type { EmbeddedFieldRow, StaleTargetRow } from './stale'
export {
  clearEmbeddingStaleOp,
  flagEmbeddingStaleOps,
  recomputeStaleOp,
  SOURCE_TABLES,
} from './stale'
export { compositeText, parseSourceHash, sourceHash } from './source-hash'
export type { SourceHash } from './source-hash'
export type { RowQuery } from './field-rows'
export { branchRowsQuery, countStaleRows, staleRowsQuery, toEmbeddedFieldRow } from './field-rows'
