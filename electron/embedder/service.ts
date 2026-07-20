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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getPipeline(modelDir: string): Promise<FeaturePipeline> {
  let pipe = pipelines.get(modelDir)
  if (!pipe) {
    pipe = buildPipeline(modelDir)
    pipelines.set(modelDir, pipe)
    // A failed init must not poison the cache — drop it so a later call can retry
    // once the user fixes the model dir.
    pipe.catch(() => pipelines.delete(modelDir))
  }
  return pipe
}

async function buildPipeline(modelDir: string): Promise<FeaturePipeline> {
  const transformers = await import('@huggingface/transformers')
  transformers.env.allowRemoteModels = false
  // pipeline()'s declared return is a union over every task's pipeline class,
  // which TS can't represent (TS2590); cast the factory to the narrow shape we use.
  const pipeline = transformers.pipeline as unknown as (
    task: 'feature-extraction',
    model: string,
    options: { local_files_only: boolean; subfolder: string; model_file_name: string },
  ) => Promise<FeaturePipeline>
  // The on-disk layout is flat (model.onnx at the folder root, not HF's onnx/
  // subfolder). subfolder:'' + model_file_name:'model' points the loader at it
  // without restructuring storage; config.json + tokenizers are read from the root.
  return pipeline('feature-extraction', modelDir, {
    local_files_only: true,
    subfolder: '',
    model_file_name: 'model',
  })
}

export async function embed(args: { modelDir: string; texts: string[] }): Promise<EmbedResult> {
  if (args.texts.length === 0) return { ok: true, vectors: [], dim: 0 }

  let pipe: FeaturePipeline
  try {
    pipe = await getPipeline(args.modelDir)
  } catch (error) {
    return { ok: false, error: { kind: 'init', message: messageOf(error) } }
  }

  try {
    const output = await pipe(args.texts, { pooling: 'mean', normalize: true })
    const vectors = output.tolist() as number[][]
    const dim = output.dims[output.dims.length - 1] ?? 0
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
    const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as {
      id: string
      installedAt: number
    }
    installed.push({ id: meta.id, installedAt: meta.installedAt, sizeBytes: folderSizeBytes(dir) })
  }
  return installed
}
