import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { embeddersRoot } from './paths'
import type { EmbedderErrorEnvelope, EmbedderInstalled } from './types'

type EmbeddingTensor = { tolist(): number[][]; dims: number[] }
type FeaturePipeline = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<EmbeddingTensor>

type EmbedResult =
  | { ok: true; vectors: number[][]; dim: number }
  | { ok: false; error: EmbedderErrorEnvelope }

type SmokeResult = { ok: true; dim: number } | { ok: false; error: EmbedderErrorEnvelope }

// Lazy per-modelDir cache. Nothing here touches transformers.js until the first
// embed/smokeTest call — the dynamic import inside buildPipeline keeps main-process
// boot cost at zero, which docs/memory/model-management.md → Embedder failures
// makes an acceptance criterion ("no embedder code runs before first call").
const pipelines = new Map<string, Promise<FeaturePipeline>>()

let pipelineFactory: (modelDir: string) => Promise<FeaturePipeline> = buildPipeline

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getPipeline(modelDir: string): Promise<FeaturePipeline> {
  let pipe = pipelines.get(modelDir)
  if (!pipe) {
    pipe = pipelineFactory(modelDir)
    pipelines.set(modelDir, pipe)
    // A failed init must not poison the cache — drop it so a later call can retry
    // once the user fixes the model dir.
    pipe.catch(() => pipelines.delete(modelDir))
  }
  return pipe
}

// A removed/re-downloaded model reuses its dir path; without eviction the cache
// would keep serving vectors from the deleted model. main.ts evicts before deletePartial.
export function evictPipeline(modelDir: string): void {
  pipelines.delete(modelDir)
}

export function __setPipelineFactoryForTest(
  factory: ((modelDir: string) => Promise<FeaturePipeline>) | null,
): void {
  pipelineFactory = factory ?? buildPipeline
  pipelines.clear()
}

async function buildPipeline(modelDir: string): Promise<FeaturePipeline> {
  const transformers = await import('@huggingface/transformers')
  transformers.env.allowRemoteModels = false
  // pipeline()'s declared return is a union over every task's pipeline class,
  // which TS can't represent (TS2590); cast the factory to the narrow shape we use.
  const pipeline = transformers.pipeline as unknown as (
    task: 'feature-extraction',
    model: string,
    options: {
      local_files_only: boolean
      subfolder: string
      model_file_name: string
      use_external_data_format: boolean
      session_options: { enableCpuMemArena: boolean }
    },
  ) => Promise<FeaturePipeline>
  // The on-disk layout is flat (model.onnx at the folder root, not HF's onnx/
  // subfolder). subfolder:'' + model_file_name:'model' points the loader at it
  // without restructuring storage; config.json + tokenizers are read from the root.
  // use_external_data_format:false — config.json's transformers.js_config would
  // otherwise demand a `model.onnx_data` sidecar (name derived from our renamed
  // graph, not the protobuf reference) and its missing-file path never settles in
  // Electron main. In Node the fetched sidecar is discarded anyway: ORT loads the
  // model by path and resolves the protobuf-referenced *_data file itself, which
  // is why the sidecar keeps its graph-referenced basename on disk. Relies on
  // env.useFSCache staying true (default) so ORT gets a path, not a buffer.
  // enableCpuMemArena:false — ORT's BFC arena grows by doubling into single
  // huge chunks; one of those trips Chromium's allocator CHECK in the Electron
  // main process (silent SIGTRAP at electron+0x496dfcf, first inference on
  // ~300MB models; fine under ELECTRON_RUN_AS_NODE). Arena off = plain mallocs.
  return pipeline('feature-extraction', modelDir, {
    local_files_only: true,
    subfolder: '',
    model_file_name: 'model',
    use_external_data_format: false,
    session_options: { enableCpuMemArena: false },
  })
}

// One pipeline call is an un-interruptible ONNX run holding every text's activations, so a
// chunk boundary bounds peak memory and is the only point a cancel can land.
// Duplicates drain.ts's BATCH_SIZE because electron/tsconfig.json scopes rootDir to
// electron/ with no path aliases: the two drift independently, and the fixture size in
// e2e/tests/embedder-cancel.spec.ts derives from this one.
const EMBED_CHUNK = 16

// onnxruntime-node@1.21 calls the native session synchronously inside a setImmediate
// (dist/backend.js), so a chunk settles in a microtask while a cancel IPC is still a queued
// macrotask. Yielding before the abort check keeps cancel latency at the running chunk.
const yieldToMacrotasks = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

export async function embed(args: {
  modelDir: string
  texts: string[]
  signal?: AbortSignal
}): Promise<EmbedResult> {
  if (args.texts.length === 0) return { ok: true, vectors: [], dim: 0 }

  let pipe: FeaturePipeline
  try {
    pipe = await getPipeline(args.modelDir)
  } catch (error) {
    return { ok: false, error: { kind: 'init', message: messageOf(error) } }
  }

  try {
    const vectors: number[][] = []
    let dim = 0
    for (let i = 0; i < args.texts.length; i += EMBED_CHUNK) {
      if (i > 0) await yieldToMacrotasks()
      if (args.signal?.aborted) {
        return { ok: false, error: { kind: 'cancelled', message: 'embed cancelled' } }
      }
      const output = await pipe(args.texts.slice(i, i + EMBED_CHUNK), {
        pooling: 'mean',
        normalize: true,
      })
      vectors.push(...output.tolist())
      // The first chunk fixes the dim: a later disagreeing one would return a width
      // describing none of the vectors ahead of it and still pass the facade's dim check.
      const chunkDim = output.dims[output.dims.length - 1] ?? 0
      if (i === 0) {
        dim = chunkDim
      } else if (chunkDim !== dim) {
        return {
          ok: false,
          error: {
            kind: 'call',
            message: `embedding dim changed mid-embed: expected ${dim}, got ${chunkDim}`,
          },
        }
      }
    }
    // The loop checks before each chunk, so a cancel landing during the last one
    // would still report success — a single-chunk embed being uncancellable outright.
    if (args.signal) {
      await yieldToMacrotasks()
      if (args.signal.aborted) {
        return { ok: false, error: { kind: 'cancelled', message: 'embed cancelled' } }
      }
    }
    return { ok: true, vectors, dim }
  } catch (error) {
    return { ok: false, error: { kind: 'call', message: messageOf(error) } }
  }
}

export async function smokeTest(args: { modelDir: string }): Promise<SmokeResult> {
  const result = await embed({ modelDir: args.modelDir, texts: ['smoke test'] })
  if (!result.ok) return result
  return { ok: true, dim: result.dim }
}

function folderSizeBytes(dir: string): number {
  let size = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    size += entry.isDirectory() ? folderSizeBytes(path) : statSync(path).size
  }
  return size
}

export function listInstalled(): EmbedderInstalled[] {
  const root = embeddersRoot()
  if (!existsSync(root)) return []

  const installed: EmbedderInstalled[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name)
    if (!existsSync(join(dir, 'model.onnx')) || !existsSync(join(dir, 'meta.json'))) continue
    // A corrupt meta.json in one folder must not sink the whole list — skip it.
    try {
      const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as {
        id: string
        installedAt: number
      }
      installed.push({
        id: meta.id,
        installedAt: meta.installedAt,
        sizeBytes: folderSizeBytes(dir),
      })
    } catch {
      continue
    }
  }
  return installed
}
