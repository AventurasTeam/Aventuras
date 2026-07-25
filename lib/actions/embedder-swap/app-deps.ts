import { eq } from 'drizzle-orm'

import type { ProviderInstanceWithStub } from '@/lib/ai'
import { resolveModelCapabilities } from '@/lib/ai'
import {
  branches,
  countStaleRows,
  db,
  execRaw,
  listTableNames,
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
  type StorySettings,
  type VecTargetKind,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  createDrainController,
  embedAndBuildVecOps,
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

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

// Per-story single-flight lock (engine caller contract): concurrent engine calls
// for one story would both pass the advisory swap-target guard and stage vectors
// under different targets, orphaning the loser's rows. Reject rather than queue.
const inFlight = new Map<string, Promise<unknown>>()

export async function runExclusive<T>(storyId: string, fn: () => Promise<T>): Promise<T> {
  if (inFlight.has(storyId)) throw new SwapBusyError(storyId)
  const run = fn()
  inFlight.set(storyId, run)
  try {
    return await run
  } finally {
    inFlight.delete(storyId)
  }
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
        return embedderSwapStore.getState().cancelRequested
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
    caps?.matryoshkaSupported != null
      ? { matryoshkaSupported: caps.matryoshkaSupported }
      : undefined,
  )
}

function providerFor(config: EmbedderConfig): ProviderInstanceWithStub | undefined {
  if (config.backend !== 'provider') return undefined
  return appSettingsStore
    .getAppSettings()
    .providers.find((provider) => provider.id === config.providerId)
}

// Single-sources the engine/drain embed composition: raw DDL through execRaw,
// provider instance resolved from the config's own providerId.
const makeEmbedRows = (): SwapDeps['embedRows'] => (config, rows) =>
  embedAndBuildVecOps(config, rows, execRaw, providerFor(config))

function composeSwapDeps(storyId: string, ctx: DbCtx): SwapDeps {
  return {
    runInTransaction: ctx.runInTransaction,
    queryAll: queryRows,
    listVecTables: listTableNames,
    embedRows: makeEmbedRows(),
    now: () => Date.now(),
    ...makeCallbackGuards(storyId),
  }
}

function defaultCtx(): DbCtx {
  return { db, runInTransaction }
}

async function loadSwapContext(
  storyId: string,
  ctx: DbCtx,
): Promise<{ settings: StorySettings; branchIds: string[] }> {
  const [row] = await ctx.db
    .select({ settings: stories.settings })
    .from(stories)
    .where(eq(stories.id, storyId))
  const parsed = row ? storySettingsSchema.safeParse(row.settings) : undefined
  if (!parsed?.success) throw new SwapStoryMissingError(storyId)
  const branchRows = await ctx.db
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.storyId, storyId))
  return { settings: parsed.data, branchIds: branchRows.map((branch) => branch.id) }
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
  const [row] = await ctx.db
    .select({ settings: stories.settings })
    .from(stories)
    .where(eq(stories.id, storyId))
  const parsed = row ? storySettingsSchema.safeParse(row.settings) : undefined
  if (parsed?.success) currentStoryStore.set({ ...open, settings: parsed.data })
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

async function runStagingSwap(
  storyId: string,
  ctx: DbCtx,
  invoke: (deps: SwapDeps, params: SwapParams) => Promise<'completed' | 'cancelled'>,
  resolveTarget: (settings: StorySettings) => EmbeddingTarget,
): Promise<'completed' | 'cancelled'> {
  return runExclusive(storyId, async () => {
    const { settings, branchIds } = await loadSwapContext(storyId, ctx)
    const target = resolveTarget(settings)
    const resolution = resolveStorySwapConfig(storyId, target)
    if (!resolution.ok) throw new SwapConfigError(storyId, resolution.reason)
    const deps = composeSwapDeps(storyId, ctx)
    // cancelRequested is a global flag; a prior cancel that ended without a
    // running loop leaves it set. Clear it before staging so the engine's first
    // batch poll can't silently cancel this fresh swap.
    embedderSwapStore.clearProgress()
    embedderSwapStore.setProgress({ storyId, done: 0, total: 0 })
    try {
      const outcome = await invoke(deps, {
        storyId,
        branchIds,
        // Current recorded model id — stays OLD until phase-2 commits, so both
        // resume and re-index read the same value the flip will replace.
        currentModelId: settings.embedding_model_id,
        currentSwapTarget: settings.embedding_swap_target ?? null,
        targetConfig: resolution.config,
      })
      await refreshStores(storyId, ctx)
      await refreshEmbeddingStatus(storyId, ctx)
      return outcome
    } finally {
      embedderSwapStore.clearProgress()
    }
  })
}

export function startStorySwap(
  storyId: string,
  target: EmbeddingTarget,
  ctx: DbCtx = defaultCtx(),
): Promise<'completed' | 'cancelled'> {
  return runStagingSwap(storyId, ctx, startSwap, () => target)
}

export function resumeStorySwap(
  storyId: string,
  ctx: DbCtx = defaultCtx(),
): Promise<'completed' | 'cancelled'> {
  return runStagingSwap(storyId, ctx, resumeSwap, (settings) => {
    if (settings.embedding_swap_target == null) throw new SwapNotInProgressError(storyId)
    return markerTarget(settings)
  })
}

export function reindexStoryNow(
  storyId: string,
  ctx: DbCtx = defaultCtx(),
): Promise<'completed' | 'cancelled'> {
  return runStagingSwap(storyId, ctx, reindexStory, (settings) => ({
    modelId: settings.embedding_model_id,
    backend: settings.embeddingBackend,
    providerId: settings.embedding_provider_id,
  }))
}

export async function cancelStorySwap(storyId: string, ctx: DbCtx = defaultCtx()): Promise<void> {
  // Signal a running staging loop to unwind itself via its isCancelRequested check.
  embedderSwapStore.requestCancel()
  const active = inFlight.get(storyId)
  if (active != null) {
    // The loop owns the unwind (delete NEW rows, clear marker, re-flag); just wait.
    await active.catch(() => {})
    return
  }
  // No loop running (a paused / crash-recovered swap with the marker still set):
  // run the engine's cancel directly. clearProgress in finally covers both the
  // no-marker no-op and the ran-cancel paths, so the global flag can't leak.
  await runExclusive(storyId, async () => {
    try {
      const { settings, branchIds } = await loadSwapContext(storyId, ctx)
      if (settings.embedding_swap_target == null) return
      const target = markerTarget(settings)
      const resolution = resolveStorySwapConfig(storyId, target)
      if (!resolution.ok) throw new SwapConfigError(storyId, resolution.reason)
      await cancelSwap(composeSwapDeps(storyId, ctx), {
        storyId,
        branchIds,
        targetModelId: target.modelId,
        currentModelId: settings.embedding_model_id,
      })
      await refreshStores(storyId, ctx)
      await refreshEmbeddingStatus(storyId, ctx)
    } finally {
      embedderSwapStore.clearProgress()
    }
  })
}

export async function relabelStory(
  storyId: string,
  target: EmbeddingTarget,
  ctx: DbCtx = defaultCtx(),
): Promise<void> {
  await runExclusive(storyId, async () => {
    const { settings, branchIds } = await loadSwapContext(storyId, ctx)
    // Relabel's pre-delete is destructive toward target-model rows; a swap in
    // flight would have staged exactly those, so refuse until it settles.
    if (settings.embedding_swap_target != null) throw new RelabelBlockedError(storyId)
    await relabelModel(composeSwapDeps(storyId, ctx), {
      storyId,
      branchIds,
      oldModelId: settings.embedding_model_id,
      target,
    })
    await refreshStores(storyId, ctx)
  })
}

// --- drain worker composition (boot wires the controller via buildDrainController,
// which self-attaches the status sink below) ------------------------------------

let drainStatusSink: ((storyId: string, remaining: number) => void) | null = null

export function setDrainStatusSink(
  sink: ((storyId: string, remaining: number) => void) | null,
): void {
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

function resolveDrainConfig(storyId: string): EmbedderConfigResolution {
  const open = currentStoryStore.getCurrentStory()
  if (open?.storyId !== storyId) return { ok: false, reason: 'no-model' }
  // A swap in flight owns the vec tables; let its batched embeds and the blocking
  // sync stage handle staleness rather than racing them from the warm-cache worker.
  if (open.settings.embedding_swap_target != null) return { ok: false, reason: 'no-model' }
  return resolveStorySwapConfig(storyId, {
    modelId: open.settings.embedding_model_id,
    backend: open.settings.embeddingBackend,
    providerId: open.settings.embedding_provider_id,
  })
}

export function buildDrainController(
  ctx: DbCtx = defaultCtx(),
): ReturnType<typeof createDrainController> {
  // Attaches the Task 8 seam to the status store so the Memory panel / reader
  // pill see the worker's progress without either polling it directly. The
  // drain only ever drains the open story, so a mismatch here means the user
  // navigated away mid-drain — drop the write rather than clobber the newly
  // open story's slot (this sink bypasses statusRequestGeneration).
  setDrainStatusSink((storyId, remaining) => {
    if (currentStoryStore.getCurrentStory()?.storyId !== storyId) return
    embeddingStatusStore.setStatus(storyId, remaining)
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
    embedRows: makeEmbedRows(),
    runInTransaction: ctx.runInTransaction,
    onDrained: (storyId, remaining) => {
      drainStatusSink?.(storyId, remaining)
      logger.debug('embedder.drain_progress', { storyId, remaining })
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  })
}
