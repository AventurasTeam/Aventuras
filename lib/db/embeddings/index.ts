export type { VecTargetKind } from './vec-tables'
export {
  VEC_FAMILIES,
  deleteBranchModelVecOps,
  deleteBranchVecOps,
  ensureVecTables,
  ensureVecTablesSql,
  dimFamilyTables,
  familyTablesFor,
  findVecDims,
  isVecFamilyTable,
  vecRowPk,
  vecTableName,
} from './vec-tables'
export type { VecWrite } from './ops'
export { deleteVecOps, packFloat32, upsertVecOps } from './ops'
export type { KnnParams } from './knn'
export { knnQuery, unpackFloat32, vectorsByIdQuery } from './knn'
export type { EmbeddedFieldRow, StaleTargetRow } from './stale'
export {
  clearEmbeddingStaleOp,
  flagEmbeddingStaleOps,
  recomputeStaleOps,
  SOURCE_TABLES,
} from './stale'
export { compositeText, parseSourceHash, sourceHash } from './source-hash'
export type { SourceHash } from './source-hash'
export {
  branchRowsQuery,
  countEmbeddableRows,
  countStaleRows,
  staleRowsQuery,
  toEmbeddedFieldRow,
} from './field-rows'
