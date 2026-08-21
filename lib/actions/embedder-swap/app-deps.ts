import { eq } from 'drizzle-orm'

import type { ProviderInstanceWithStub } from '@/lib/ai'
import { resolveModelCapabilities } from '@/lib/ai'
import {
  branches,
  clearEmbeddingStaleFlagsOps,
  countEmbeddableRows,
  countStaleRows,
  db,
  execRaw,
  isVecFamilyTable,
  listTableNames,
  partitionByStoredVector,
  queryRows,
  runInTransaction,
  staleRowsQuery,
  stories,
  storySettingsSchema,
  toEmbeddedFieldRow,
  VEC_FAMILIES,
  type DbCtx,
  type EmbeddedFieldRow,
  type EmbeddingTarget,
  type SqlOp,
  type StorySettings,
  type VecTargetKind,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  createDrainController,
  embedderReadDim,
  embedRowsToVecOps,
  embedTexts,
  type DrainDeps,
  resolveEmbedderConfig,
  type EmbedderAppDefaults,
  type EmbedderConfig,
  type EmbedderConfigResolution,
} from '@/lib/embedder'
import {
  appSettingsStore,
  type AppSettingsSnapshot,
  currentStoryStore,
  embedderSwapStore,
  embeddingStatusStore,
  generationStore,
  rehydrateStories,
  storiesStore,
} from '@/lib/stores'

import {
  cancelSwap,
  reindexStory,
  relabelModel,
  resumeSwap,
  startSwap,
  SwapNotInProgressError,
  SwapStoryMissingError,
  type SwapDeps,
  type SwapParams,
} from './engine'

type SwapConfigReason = Extract<EmbedderConfigResolution, { ok: false }>['reason']

/**
 * A second embedder operation was requested for a story while one is already
 * running. The UI disables its buttons; this typed rejection is the belt-and-
 * braces the engine's single-flight caller contract requires.
 */
export class SwapBusyError extends Error {
  constructor(storyId: string) {
    super(`An embedder operation is already running for story ${storyId}`)
    this.name = 'SwapBusyError'
  }
}

export class SwapConfigError extends Error {
  readonly reason: SwapConfigReason

  constructor(storyId: string, reason: SwapConfigReason) {
    super(`Cannot resolve an embedder config for story ${storyId}: ${reason}`)
    this.name = 'SwapConfigError'
    this.reason = reason
  }
}

export class RelabelBlockedError extends Error {
  constructor(storyId: string) {
    super(`Refusing to relabel story ${storyId} while an embedder swap is in flight`)
    this.name = 'RelabelBlockedError'
  }
}

export type StoryEmbedderActionRejection = {
  status: 'rejected'
  reason: 'generation in flight'
}

const GENERATION_IN_FLIGHT_REJECTION: StoryEmbedderActionRejection = {
  status: 'rejected',
  reason: 'generation in flight',
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

type StoryAdmission =
  | { owner: 'turn'; holders: number }
  | { owner: 'embedder'; release: () => void }

// Turns read/write the served vec family; embedder operations mutate its ownership.
// Turn holders may overlap because the pipeline gate still chooses the generation,
// but any holder excludes an embedder mutation before either side writes.
const storyAdmissions = new Map<string, StoryAdmission>()

// Per-story engine handle retained separately from admission: cancellation awaits
// the live swap promise, while turn admission only needs to know who owns the gate.
const inFlight = new Map<string, Promise<unknown>>()

export type TurnAdmissionResult<T> =
  | { admitted: true; value: T }
  | { admitted: false; blockedBy: 'embedder-swap' }

export async function withTurnAdmission<T>(
  storyId: string,
  fn: () => Promise<T>,
): Promise<TurnAdmissionResult<T>> {
  const active = storyAdmissions.get(storyId)
  if (active?.owner === 'embedder') return { admitted: false, blockedBy: 'embedder-swap' }

  const admission = active ?? { owner: 'turn' as const, holders: 0 }
  admission.holders += 1
  storyAdmissions.set(storyId, admission)
  try {
    return { admitted: true, value: await fn() }
  } finally {
    admission.holders -= 1
    if (admission.holders === 0 && storyAdmissions.get(storyId) === admission) {
      storyAdmissions.delete(storyId)
    }
  }
}

function acquireEmbedderAdmission(storyId: string): (() => void) | null {
  if (storyAdmissions.has(storyId)) return null
  const admission: StoryAdmission = {
    owner: 'embedder',
    release: () => {
      if (storyAdmissions.get(storyId) === admission) storyAdmissions.delete(storyId)
    },
  }
  storyAdmissions.set(storyId, admission)
  return admission.release
}

/**
 * Whether a swap owns this story's vec tables right now. Two authorities for the
 * same reason `resolveDrainConfig` needs both: the marker only reaches the store
 * once `syncStoresAfterEngine` runs, so a swap started this session is invisible
 * in `settings` while it matters most, and the in-process lock knows nothing
 * about a marker left by a previous process.
 */
export function isStorySwapPending(storyId: string): boolean {
  if (inFlight.has(storyId)) return true
  const open = currentStoryStore.getCurrentStory()
  return open?.storyId === storyId && open.settings.embedding_swap_target != null
}

async function runAdmittedEmbedder<T>(
  storyId: string,
  fn: () => Promise<T>,
  releaseAdmission: () => void,
): Promise<T> {
  let run: Promise<T>
  try {
    run = fn()
  } catch (error) {
    releaseAdmission()
    throw error
  }
  inFlight.set(storyId, run)
  try {
    return await run
  } finally {
    inFlight.delete(storyId)
    releaseAdmission()
  }
}

export async function runExclusive<T>(storyId: string, fn: () => Promise<T>): Promise<T> {
  const releaseAdmission = acquireEmbedderAdmission(storyId)
  if (releaseAdmission == null) throw new SwapBusyError(storyId)
  return runAdmittedEmbedder(storyId, fn, releaseAdmission)
}

async function runUserEmbedderAction<T>(
  storyId: string,
  fn: () => Promise<T>,
): Promise<T | StoryEmbedderActionRejection> {
  if (storyAdmissions.get(storyId)?.owner === 'turn') {
    return GENERATION_IN_FLIGHT_REJECTION
  }
  const releaseAdmission = acquireEmbedderAdmission(storyId)
  if (releaseAdmission == null) throw new SwapBusyError(storyId)
  if (generationStore.isUserEditBlocked()) {
    releaseAdmission()
    return GENERATION_IN_FLIGHT_REJECTION
  }
  return runAdmittedEmbedder(storyId, fn, releaseAdmission)
}

// The store/UI callbacks are wrapped so a throwing subscriber can never propagate
// into the engine mid-swap and abort a staging run over a cosmetic render error.
export function makeCallbackGuards(
  storyId: string,
): Pick<SwapDeps, 'onProgress' | 'isCancelRequested'> {
  return {
    onProgress: (done, total) => {
      try {
        embedderSwapStore.setProgress({ storyId, done, total })
      } catch (error) {
        logger.debug('embedder.swap_progress_failed', { error: messageOf(error) })
      }
    },
    isCancelRequested: () => {
      try {
        return embedderSwapStore.isCancelRequested(storyId)
      } catch (error) {
        logger.debug('embedder.swap_cancel_read_failed', { error: messageOf(error) })
        return false
      }
    },
  }
}

function appEmbedderDefaults(app: AppSettingsSnapshot): EmbedderAppDefaults {
  return {
    embeddingModelId: app.embeddingModelId,
    embeddingProviderId: app.embeddingProviderId,
    defaultStorySettings: { embeddingBackend: app.defaultStorySettings.embeddingBackend },
  }
}

/**
 * The in-flight swap's target, read back from the marker. An absent
 * `embedding_swap_backend` means the target shares the story's current backend —
 * which is both the same-backend case and what a marker written before
 * cross-backend swaps existed meant, so no migration is needed.
 */
function markerTarget(settings: StorySettings): EmbeddingTarget {
  const backend = settings.embedding_swap_backend ?? settings.embeddingBackend
  return {
    modelId: settings.embedding_swap_target ?? settings.embedding_model_id,
    backend,
    providerId:
      settings.embedding_swap_backend != null
        ? settings.embedding_swap_provider_id
        : settings.embedding_provider_id,
  }
}

export function resolveStorySwapConfig(
  storyId: string,
  target: EmbeddingTarget,
): EmbedderConfigResolution {
  const app = appSettingsStore.getAppSettings()
  const story = storiesStore.getStories().rows.find((row) => row.id === storyId)
  const settings = story?.settings ?? null
  if (settings == null) return { ok: false, reason: 'no-model' }

  // The TARGET's provider, not the story's: a cross-backend swap resolves a
  // provider model whose capabilities live under the provider it is served by.
  const providerId =
    target.backend === 'provider' ? target.providerId : settings.embedding_provider_id
  const caps =
    providerId != null
      ? resolveModelCapabilities(providerId, target.modelId, app.providers)
      : undefined
  // Target overrides the story's recorded backend / id / provider — resolving a
  // provider model against the story's still-current local backend is the
  // `unknown-local-model` failure cross-backend swaps exist to avoid.
  // effectiveDim stays the story's locked dim (canon: re-index reuses the stored
  // dim, never re-picks).
  return resolveEmbedderConfig(
    {
      ...settings,
      embeddingBackend: target.backend,
      embedding_model_id: target.modelId,
      embedding_provider_id: providerId ?? undefined,
    },
    appEmbedderDefaults(app),
    caps != null
      ? {
          providerDim: caps.embeddingDim,
          matryoshkaSupported: caps.matryoshkaSupported,
        }
      : undefined,
  )
}

function providerFor(config: EmbedderConfig): ProviderInstanceWithStub | undefined {
  if (config.backend !== 'provider') return undefined
  return appSettingsStore
    .getAppSettings()
    .providers.find((provider) => provider.id === config.providerId)
}

// Single-sources the embed composition for the swap engine, the drain worker and
// the blocking sync stage: raw DDL through execRaw, provider instance resolved
// from the config's own providerId. Only a swap's phase-2 sweep needs the dim its
// staging landed on; the other two take the ops alone.
const swapEmbedRows: SwapDeps['embedRows'] = (config, rows) =>
  embedRowsToVecOps(config, rows, execRaw, providerFor(config))

const drainEmbedRows: DrainDeps['embedRows'] = async (config, rows) =>
  (await embedRowsToVecOps(config, rows, execRaw, providerFor(config))).ops

/**
 * Narrowed to the dim retrieval reads: a match in another dim family would clear the
 * flag on a row whose served-family vector is absent, and nothing re-derives that. An
 * unknown dim narrows to nothing — revalidating nothing only costs a re-embed. Filtered
 * by name, not `vecTableName`, whose dim assertion would throw on a malformed config.
 */
async function revalidationTables(config: EmbedderConfig): Promise<string[]> {
  // Ahead of the table listing: an unknown dim needs no sqlite_master scan, and
  // this runs on the blocking sync path as well as the drain's idle pass.
  const dim = embedderReadDim(config)
  if (dim === null) return []
  const tableNames = await listTableNames()
  return tableNames.filter((name) => isVecFamilyTable(name) && name.endsWith(`_${dim}`))
}

/**
 * `embedding_stale` says "a writer touched this row", not "the stored vector is
 * wrong": content restored to where its vector already is clears rather than
 * re-embeds (retrieval.md → Compute lifecycle).
 */
async function revalidateAgainstStoredVectors(
  config: EmbedderConfig,
  rows: EmbeddedFieldRow[],
): Promise<{ staleRows: EmbeddedFieldRow[]; freshOps: SqlOp[] }> {
  if (rows.length === 0) return { staleRows: [], freshOps: [] }
  const { staleRows, freshRows } = await partitionByStoredVector(
    rows,
    config.modelId,
    await revalidationTables(config),
    queryRows,
  )
  return { staleRows, freshOps: clearEmbeddingStaleFlagsOps(freshRows) }
}

/**
 * The embed surface a retrieval pass needs, resolved off the open story. Unlike
 * the drain's, both calls take a signal: a turn blocks on them, so a stalled
 * provider has to be interruptible rather than parking the turn indefinitely.
 */
export function composeRetrievalEmbedDeps(config: EmbedderConfig): {
  embedTexts: (
    texts: string[],
    abortSignal?: AbortSignal,
  ) => Promise<{ vectors: Float32Array[]; dim: number }>
  embedRows: (rows: EmbeddedFieldRow[], abortSignal?: AbortSignal) => Promise<SqlOp[]>
  loadStaleRows: (branchIds: readonly string[]) => Promise<EmbeddedFieldRow[]>
  revalidateRows: (
    rows: EmbeddedFieldRow[],
  ) => Promise<{ staleRows: EmbeddedFieldRow[]; freshOps: SqlOp[] }>
} {
  return {
    // 'query' intent, not 'document': the local model's query prefix is what
    // puts the three query vectors in the same space as the stored rows.
    embedTexts: (texts, abortSignal) =>
      embedTexts(config, texts, 'query', providerFor(config), abortSignal),
    embedRows: async (rows, abortSignal) =>
      (await embedRowsToVecOps(config, rows, execRaw, providerFor(config), abortSignal)).ops,
    loadStaleRows,
    revalidateRows: (rows) => revalidateAgainstStoredVectors(config, rows),
  }
}

function composeSwapDeps(storyId: string, ctx: DbCtx): SwapDeps {
  return {
    runInTransaction: ctx.runInTransaction,
    queryAll: queryRows,
    listVecTables: listTableNames,
    embedRows: swapEmbedRows,
    now: () => Date.now(),
    ...makeCallbackGuards(storyId),
  }
}

function defaultCtx(): DbCtx {
  return { db, runInTransaction }
}

// A missing row and a Zod-rejected row are one answer: no settings blob to swap.
// They are not one diagnosis — SwapStoryMissingError downstream cannot tell them
// apart, so the rejected blob says so here or nothing does.
async function readStorySettings(storyId: string, ctx: DbCtx): Promise<StorySettings | null> {
  const [row] = await ctx.db
    .select({ settings: stories.settings })
    .from(stories)
    .where(eq(stories.id, storyId))
  if (!row) return null
  const parsed = storySettingsSchema.safeParse(row.settings)
  if (!parsed.success) {
    logger.warn('embedder.swap_settings_unreadable', {
      storyId,
      issues: parsed.error.issues.length,
    })
    return null
  }
  return parsed.data
}

async function loadSwapContext(
  storyId: string,
  ctx: DbCtx,
): Promise<{ settings: StorySettings; branchIds: string[] }> {
  const settings = await readStorySettings(storyId, ctx)
  if (!settings) throw new SwapStoryMissingError(storyId)
  const branchRows = await ctx.db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.storyId, storyId))
  return { settings, branchIds: branchRows.map((branch) => branch.id) }
}

/**
 * Republishes committed DB state to the stores after ANY engine exit. The swap
 * marker commits before phase 1, so a thrown phase-1 leaves the DB holding a
 * marker the stores have never seen — the panel then keeps both actions enabled,
 * never offers Resume, and every retry throws SwapInProgressError.
 *
 * Never throws: it runs on the failure path, where replacing the engine's error
 * with a refresh error would lose the only useful diagnosis.
 */
async function syncStoresAfterEngine(storyId: string, ctx: DbCtx): Promise<void> {
  try {
    await refreshStores(storyId, ctx)
  } catch (error) {
    logger.warn('embedder.swap_store_refresh_failed', { storyId, error: messageOf(error) })
  }
  await refreshEmbeddingStatus(storyId, ctx)
}

// Mirrors updateStorySettings' tail: the write already committed, so a failed
// rehydrate is logged rather than thrown — the swap succeeded regardless.
async function refreshStores(storyId: string, ctx: DbCtx): Promise<void> {
  if (!(await rehydrateStories(ctx.db))) {
    logger.warn('embedder.swap_store_refresh_failed', { storyId })
    return
  }
  const open = currentStoryStore.getCurrentStory()
  if (open?.storyId !== storyId) return
  const settings = await readStorySettings(storyId, ctx)
  if (settings) currentStoryStore.set({ ...open, settings })
}

// Global, not per-story: embeddingStatusStore is a single slot, so the only
// coherent policy is "the most recently issued call wins" — a slower, earlier
// call (e.g. a mount-refresh for a story the user has since navigated away
// from) resolving after a newer one must not clobber the newer result.
let statusRequestGeneration = 0

/**
 * Recomputes the story's stale-row total and publishes it to
 * `embeddingStatusStore` — the Memory panel and the reader's status pill both
 * read from there rather than querying directly. Never throws: a failed count
 * (including "no DB bridge", the common case in tests) is logged and dropped,
 * matching `refreshStores`' tail — the caller's own operation already
 * succeeded or failed on its own terms.
 */
export async function refreshEmbeddingStatus(
  storyId: string,
  ctx: DbCtx = defaultCtx(),
): Promise<void> {
  const generation = ++statusRequestGeneration
  try {
    const { branchIds } = await loadSwapContext(storyId, ctx)
    const { total } = await countStaleRows(queryRows, branchIds)
    if (generation !== statusRequestGeneration) return
    embeddingStatusStore.setStatus(storyId, total)
  } catch (error) {
    logger.warn('embedder.status_refresh_failed', { storyId, error: messageOf(error) })
  }
}

/**
 * How many rows a full re-index would re-embed — every embeddable row across
 * the story's branches, not just the stale ones the drain sees. Returns null
 * when the count can't be taken, so a caller can drop the magnitude rather than
 * present a confident zero.
 */
export async function countStoryEmbeddableRows(
  storyId: string,
  ctx: DbCtx = defaultCtx(),
): Promise<number | null> {
  try {
    const { branchIds } = await loadSwapContext(storyId, ctx)
    const { total } = await countEmbeddableRows(queryRows, branchIds)
    return total
  } catch (error) {
    logger.warn('embedder.embeddable_count_failed', { storyId, error: messageOf(error) })
    return null
  }
}

async function runStagingSwap(
  storyId: string,
  ctx: DbCtx,
  invoke: (deps: SwapDeps, params: SwapParams) => Promise<'completed' | 'cancelled'>,
  resolveTarget: (settings: StorySettings) => EmbeddingTarget,
): Promise<'completed' | 'cancelled' | StoryEmbedderActionRejection> {
  return runUserEmbedderAction(storyId, async () => {
    const { settings, branchIds } = await loadSwapContext(storyId, ctx)
    const target = resolveTarget(settings)
    const resolution = resolveStorySwapConfig(storyId, target)
    if (!resolution.ok) throw new SwapConfigError(storyId, resolution.reason)
    const deps = composeSwapDeps(storyId, ctx)
    embedderSwapStore.beginProgress(storyId)
    try {
      return await invoke(deps, {
        storyId,
        branchIds,
        // Current recorded model id — stays OLD until phase-2 commits, so both
        // resume and re-index read the same value the flip will replace.
        currentModelId: settings.embedding_model_id,
        currentSwapTarget: settings.embedding_swap_target ?? null,
        sourceDim: settings.embedding_swap_source_dim,
        targetDim: settings.embedding_swap_target_dim,
        targetConfig: resolution.config,
      })
    } finally {
      await syncStoresAfterEngine(storyId, ctx)
      embedderSwapStore.clearProgress(storyId)
    }
  })
}

export function startStorySwap(
  storyId: string,
  target: EmbeddingTarget,
  ctx: DbCtx = defaultCtx(),
): Promise<'completed' | 'cancelled' | StoryEmbedderActionRejection> {
  return runStagingSwap(storyId, ctx, startSwap, () => target)
}

export function resumeStorySwap(
  storyId: string,
  ctx: DbCtx = defaultCtx(),
): Promise<'completed' | 'cancelled' | StoryEmbedderActionRejection> {
  return runStagingSwap(storyId, ctx, resumeSwap, (settings) => {
    if (settings.embedding_swap_target == null) throw new SwapNotInProgressError(storyId)
    return markerTarget(settings)
  })
}

export function reindexStoryNow(
  storyId: string,
  ctx: DbCtx = defaultCtx(),
): Promise<'completed' | 'cancelled' | StoryEmbedderActionRejection> {
  return runStagingSwap(storyId, ctx, reindexStory, (settings) => ({
    modelId: settings.embedding_model_id,
    backend: settings.embeddingBackend,
    providerId: settings.embedding_provider_id,
  }))
}

/**
 * What a cancel actually achieved, because the caller has to tell the user apart:
 * `cancelled` unwound a staged swap, `already-completed` means the run crossed the
 * finish line past its last cancel poll and the model changed anyway, and
 * `nothing-pending` means there was no swap to stop.
 */
export type SwapCancelOutcome = 'cancelled' | 'already-completed' | 'nothing-pending'

export async function cancelStorySwap(
  storyId: string,
  ctx: DbCtx = defaultCtx(),
): Promise<SwapCancelOutcome> {
  // Signal a running staging loop to unwind itself via its isCancelRequested check.
  embedderSwapStore.requestCancel(storyId)
  const active = inFlight.get(storyId)
  // The loop owns its own unwind (delete NEW rows, clear marker, re-flag), so
  // wait for it — but take its verdict from the resolved value rather than from
  // the fact that awaiting returned. A rejection tells us nothing was unwound.
  const loopOutcome = active != null ? await active.catch(() => undefined) : undefined
  if (loopOutcome === 'cancelled') return 'cancelled'
  if (loopOutcome === 'completed') return 'already-completed'

  // Either no loop was running (a paused / crash-recovered swap with the marker
  // still set) or the loop died before its poll. The marker is the only truth
  // left, so re-read it and unwind directly if it survived. clearProgress in
  // finally covers both the no-marker no-op and the ran-cancel paths.
  return runExclusive(storyId, async (): Promise<SwapCancelOutcome> => {
    try {
      const { settings, branchIds } = await loadSwapContext(storyId, ctx)
      if (settings.embedding_swap_target == null) {
        return active != null ? 'already-completed' : 'nothing-pending'
      }
      const target = markerTarget(settings)
      const resolution = resolveStorySwapConfig(storyId, target)
      if (!resolution.ok) throw new SwapConfigError(storyId, resolution.reason)
      await cancelSwap(composeSwapDeps(storyId, ctx), {
        storyId,
        branchIds,
        targetModelId: target.modelId,
        currentModelId: settings.embedding_model_id,
        sourceDim: settings.embedding_swap_source_dim,
        targetDim: settings.embedding_swap_target_dim,
      })
      return 'cancelled'
    } finally {
      await syncStoresAfterEngine(storyId, ctx)
      embedderSwapStore.clearProgress(storyId)
    }
  })
}

export async function relabelStory(
  storyId: string,
  target: EmbeddingTarget,
  ctx: DbCtx = defaultCtx(),
): Promise<void | StoryEmbedderActionRejection> {
  return runUserEmbedderAction(storyId, async () => {
    const { settings, branchIds } = await loadSwapContext(storyId, ctx)
    // Relabel's pre-delete is destructive toward target-model rows; a swap in
    // flight would have staged exactly those, so refuse until it settles.
    if (settings.embedding_swap_target != null) throw new RelabelBlockedError(storyId)

    // Relabel rewrites the recorded model and the vec rows' model_id but never moves
    // a row between dim families, so it only holds while the target is READ at the
    // dim the vectors already live at. The engine refuses when it is not.
    //
    // Unresolvable is NOT a refusal here: relabel is the one path that may name a
    // model the catalog has never heard of (a renamed local copy, an id served
    // elsewhere), so an unknown target simply yields an unknown dim and no guard.
    const resolution = resolveStorySwapConfig(storyId, target)
    // Bracketed like runStagingSwap: relabel holds the embedder admission for its
    // duration (through runUserEmbedderAction), so isStorySwapPending refuses
    // turns, but without a progress entry the reader's own gate stays blind and
    // lets the user write a turn that submitTurn then rejects.
    embedderSwapStore.beginProgress(storyId)
    try {
      await relabelModel(composeSwapDeps(storyId, ctx), {
        storyId,
        branchIds,
        oldModelId: settings.embedding_model_id,
        target,
        targetReadDim: resolution.ok ? embedderReadDim(resolution.config) : null,
      })
      await refreshStores(storyId, ctx)
    } finally {
      embedderSwapStore.clearProgress(storyId)
    }
  })
}

// --- drain worker composition (boot wires the controller via buildDrainController,
// which self-attaches the status sink below) ------------------------------------

let drainStatusSink: ((storyId: string) => void) | null = null

export function setDrainStatusSink(sink: ((storyId: string) => void) | null): void {
  drainStatusSink = sink
}

let drainKickSink: ((storyId: string) => void) | null = null

export function setDrainKickSink(sink: ((storyId: string) => void) | null): void {
  drainKickSink = sink
}

/** Fire-and-forget kick for surfaces that just made a story embeddable (story open,
 *  embedder recovery). A no-op until boot wires the controller. */
export function kickStoryDrain(storyId: string): void {
  drainKickSink?.(storyId)
}

async function loadStaleRows(branchIds: readonly string[]): Promise<EmbeddedFieldRow[]> {
  const out: EmbeddedFieldRow[] = []
  for (const kind of Object.keys(VEC_FAMILIES) as VecTargetKind[]) {
    const query = staleRowsQuery(kind, branchIds)
    const rows = await queryRows(query.sql, query.params)
    out.push(...rows.map((row) => toEmbeddedFieldRow(kind, row)))
  }
  return out
}

export function resolveDrainConfig(storyId: string): EmbedderConfigResolution {
  const open = currentStoryStore.getCurrentStory()
  if (open?.storyId !== storyId) return { ok: false, reason: 'no-model' }
  // A swap in flight owns the vec tables; let its batched embeds and the blocking
  // sync stage handle staleness rather than racing them from the warm-cache worker.
  //
  // Two authorities, because neither covers the other: the marker only reaches
  // this store once syncStoresAfterEngine runs (i.e. after the engine settles),
  // so a swap started this session is invisible in `settings` while it matters
  // most; the in-process lock in turn knows nothing about a marker left by a
  // previous process. Draining under the old model during a swap would clear
  // embedding_stale on rows phase 2 then deletes — vectors gone, flags clean,
  // and nothing re-derives staleness today.
  if (isStorySwapPending(storyId)) return { ok: false, reason: 'no-model' }
  return resolveStorySwapConfig(storyId, {
    modelId: open.settings.embedding_model_id,
    backend: open.settings.embeddingBackend,
    providerId: open.settings.embedding_provider_id,
  })
}

export function buildDrainController(
  ctx: DbCtx = defaultCtx(),
): ReturnType<typeof createDrainController> {
  // The drain triggers a recount rather than publishing its own number: it walks
  // the OPEN BRANCH only, while refreshEmbeddingStatus counts every branch, and one
  // slot can hold only one of those meanings. The recount is five indexed counts
  // against a batch that just paid for an embedding call.
  //
  // A story mismatch means the user navigated away mid-drain: drop it rather
  // than recount for a story nobody is looking at.
  setDrainStatusSink((storyId) => {
    if (currentStoryStore.getCurrentStory()?.storyId !== storyId) return
    void refreshEmbeddingStatus(storyId, ctx)
  })
  return createDrainController({
    hasActiveRun: generationStore.hasActiveRun,
    // Scope asymmetry by design: the worker warms only the open branch, while the
    // swap engine re-embeds every branch of a story. Stale rows in other branches
    // are covered by the blocking pre-retrieval sync stage when those branches read.
    branchIdsFor: (storyId) => {
      const open = currentStoryStore.getCurrentStory()
      return open?.storyId === storyId ? [open.branchId] : []
    },
    loadStaleRows,
    resolveConfig: resolveDrainConfig,
    revalidateRows: revalidateAgainstStoredVectors,
    embedRows: drainEmbedRows,
    runInTransaction: ctx.runInTransaction,
    onDrained: (storyId) => {
      drainStatusSink?.(storyId)
      logger.debug('embedder.drain_progress', { storyId })
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  })
}
