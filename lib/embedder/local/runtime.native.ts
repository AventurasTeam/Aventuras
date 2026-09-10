import { Directory, File } from 'expo-file-system'
import type { InferenceSession, Tensor } from 'onnxruntime-react-native'

import { logger } from '@/lib/diagnostics'

import { abortedEmbedError } from './cancel'
import { embeddersRoot, modelDir } from './paths.native'
import { meanPoolAndNormalize } from './pooling'
import { lazyModule } from '../lazy-module'
import { EmbedderCallError, EmbedderCancelledError, EmbedderInitError } from '../types'

export type LocalEmbedResult = {
  vectors: Float32Array[]
  dim: number
  /** Indices of the input texts the tokenizer cut before inference. */
  truncated: number[]
}

type EncodedTensor = { data: BigInt64Array; dims: readonly number[] }
type Encoded = {
  input_ids: EncodedTensor
  attention_mask: EncodedTensor
  token_type_ids?: EncodedTensor
}
type TokenizerFn = ((
  text: string,
  options: { add_special_tokens: boolean; return_token_type_ids: boolean; truncation: boolean },
) => Encoded) & { model_max_length?: number }

// The slice of onnxruntime-react-native this runtime touches. A structural surface
// (rather than `typeof import(...)`, which the type-import lint forbids, or a banned
// namespace import) keeps the module off the top-level import graph entirely.
type OrtRuntime = {
  InferenceSession: { create(path: string): Promise<InferenceSession> }
  Tensor: new (type: 'int64', data: BigInt64Array, dims: readonly number[]) => Tensor
}
type SessionBundle = { session: InferenceSession; tokenizer: TokenizerFn; ort: OrtRuntime }

// onnxruntime-react-native's module-eval performs a native JSI install, so it must
// never be imported at the top level — the lib/embedder barrel is reachable from
// config-presence checks that run before the model is loaded (and before the
// dev-client is rebuilt). Load it lazily, only inside the session-building path.
const loadOrt = lazyModule(
  () => import('onnxruntime-react-native') as unknown as Promise<OrtRuntime>,
)

// Lazy per-model session+tokenizer cache. A model isn't loaded until first embed;
// a failed load evicts itself so a later call can retry after the user reinstalls.
const bundles = new Map<string, Promise<SessionBundle>>()

// A live token count must not build the inference session — the ~300MB half. One
// tokenizer per model, shared with the bundle and evicted under the same key.
const tokenizerOnly = new Map<string, Promise<TokenizerFn>>()

// A successfully-built session outlives the files it was built from, so a
// remove/reinstall in the same session would keep embedding through the deleted
// model and write vectors tagged with the new id. Desktop evicts via
// evictPipeline; this is the native counterpart.
export function evictBundle(modelId: string): void {
  bundles.delete(modelId)
  tokenizerOnly.delete(modelId)
}

function getTokenizerOnly(modelId: string): Promise<TokenizerFn> {
  let tokenizer = tokenizerOnly.get(modelId)
  if (!tokenizer) {
    tokenizer = loadTokenizer(modelDir(modelId))
    tokenizerOnly.set(modelId, tokenizer)
    tokenizer.catch(() => tokenizerOnly.delete(modelId))
  }
  return tokenizer
}

/**
 * Exact token counts from the model's own tokenizer. A tiktoken estimate runs up to
 * 3x under on the scripts WordPiece fragments, so user-facing numbers come from here.
 */
export async function countTokensLocal(modelId: string, texts: string[]): Promise<number[]> {
  if (texts.length === 0) return []
  let tokenizer: TokenizerFn
  try {
    tokenizer = await getTokenizerOnly(modelId)
  } catch (error) {
    throw new EmbedderInitError(error instanceof Error ? error.message : String(error), error)
  }
  try {
    return texts.map(
      (text) =>
        tokenizer(text, {
          add_special_tokens: true,
          return_token_type_ids: false,
          truncation: false,
        }).input_ids.dims.at(-1) ?? 0,
    )
  } catch (error) {
    throw new EmbedderCallError(error instanceof Error ? error.message : String(error), error)
  }
}

function getBundle(modelId: string): Promise<SessionBundle> {
  let bundle = bundles.get(modelId)
  if (!bundle) {
    bundle = buildBundle(modelId)
    bundles.set(modelId, bundle)
    bundle.catch((error: unknown) => {
      logger.error('embedder.bundle_build_failed', {
        modelId,
        error: error instanceof Error ? error.message : String(error),
      })
      bundles.delete(modelId)
    })
  }
  return bundle
}

async function loadTokenizer(dir: Directory): Promise<TokenizerFn> {
  // Construct the tokenizer from its on-disk JSON directly rather than
  // AutoTokenizer.from_pretrained: transformers.js's hub loader needs fs/fetch,
  // neither of which resolves a local file:// dir under RN. A fast tokenizer's
  // full pipeline (normalizer, pre-tokenizer, model, post-processor) lives in
  // tokenizer.json, so the base PreTrainedTokenizer reproduces the model-specific
  // subclass's output for the curated embedders (all WordPiece/BPE/Unigram).
  const tokenizerJSON = JSON.parse(await new File(dir, 'tokenizer.json').text()) as unknown
  const tokenizerConfig = JSON.parse(await new File(dir, 'tokenizer_config.json').text()) as unknown

  const transformers = await import('@huggingface/transformers')
  const { PreTrainedTokenizer } = transformers
  return new PreTrainedTokenizer(tokenizerJSON, tokenizerConfig) as unknown as TokenizerFn
}

async function buildBundle(modelId: string): Promise<SessionBundle> {
  const dir = modelDir(modelId)
  // ORT-RN takes a filesystem path, not a file:// URI. External-data sidecars
  // (e.g. Gemma's model_quantized.onnx_data) load automatically from alongside.
  const modelPath = new File(dir, 'model.onnx').uri.replace(/^file:\/\//, '')

  const ort = await loadOrt()
  const [session, tokenizer] = await Promise.all([
    ort.InferenceSession.create(modelPath),
    getTokenizerOnly(modelId),
  ])
  return { session, tokenizer, ort }
}

async function embedOne(
  bundle: SessionBundle,
  text: string,
): Promise<{ vector: Float32Array; dim: number; truncated: boolean }> {
  const { Tensor } = bundle.ort
  const encodeOpts = { add_special_tokens: true, return_token_type_ids: true }
  // Encoded untruncated first so the cut is observable at all; only a text that
  // actually overruns pays the second pass. An absent limit never truncates.
  let encoded = bundle.tokenizer(text, { ...encodeOpts, truncation: false })
  const limit = bundle.tokenizer.model_max_length
  const truncated = limit !== undefined && (encoded.input_ids.dims.at(-1) ?? 0) > limit
  if (truncated) encoded = bundle.tokenizer(text, { ...encodeOpts, truncation: true })

  const feeds: Record<string, Tensor> = {}
  for (const name of bundle.session.inputNames) {
    const source = encoded[name as keyof Encoded]
    if (source) {
      feeds[name] = new Tensor('int64', source.data, source.dims)
    } else if (name === 'token_type_ids') {
      // A tokenizer that suppresses type ids still satisfies a model that wants
      // them: a single segment is all-zero type ids.
      const zeros = new BigInt64Array(encoded.input_ids.data.length)
      feeds[name] = new Tensor('int64', zeros, encoded.input_ids.dims)
    }
  }

  const outputs = await bundle.session.run(feeds)
  const hidden = outputs[bundle.session.outputNames[0]]
  const dim = Number(hidden.dims[hidden.dims.length - 1])
  const hiddenData = hidden.data as Float32Array
  const mask = Array.from(encoded.attention_mask.data, (v) => Number(v))

  return { vector: meanPoolAndNormalize(hiddenData, mask, dim), dim, truncated }
}

export async function embedLocal(
  modelId: string,
  texts: string[],
  signal?: AbortSignal,
): Promise<LocalEmbedResult> {
  if (texts.length === 0) return { vectors: [], dim: 0, truncated: [] }

  let bundle: SessionBundle
  try {
    bundle = await getBundle(modelId)
  } catch (error) {
    throw new EmbedderInitError(error instanceof Error ? error.message : String(error), error)
  }

  try {
    const vectors: Float32Array[] = []
    const truncated: number[] = []
    let dim: number | null = null
    // ORT-RN batch=1 is fine for v1; per-text loop is deliberate, and one
    // session.run is un-interruptible, so its top is where a cancel can land.
    for (const [index, text] of texts.entries()) {
      if (signal?.aborted) throw abortedEmbedError(signal)
      const { vector, dim: d, truncated: cut } = await embedOne(bundle, text)
      if (cut) truncated.push(index)
      // Fixed by the FIRST vector, never the last, as in desktop's chunk loop: a
      // later disagreeing width would describe none of them yet still pass the dim check.
      if (dim === null) dim = d
      else if (d !== dim) {
        throw new EmbedderCallError(`embedding dim changed mid-embed: expected ${dim}, got ${d}`)
      }
      vectors.push(vector)
    }
    // The loop checks before each text, so a cancel landing during the last embedOne
    // would still report success — a single-text embed being uncancellable outright.
    if (signal?.aborted) throw abortedEmbedError(signal)
    // texts is non-empty past the guard above, so dim is set by now.
    return { vectors, dim: dim ?? 0, truncated }
  } catch (error) {
    // Already classified — re-wrapping would relabel a user stop as a generic call fault.
    // Keep EmbedderCancelledError listed: sync.ts separates the tiers by class, not message.
    if (
      error instanceof EmbedderCallError ||
      error instanceof EmbedderInitError ||
      error instanceof EmbedderCancelledError
    ) {
      throw error
    }
    throw new EmbedderCallError(error instanceof Error ? error.message : String(error), error)
  }
}

export async function smokeTestLocal(modelId: string): Promise<{ dim: number }> {
  const { dim } = await embedLocal(modelId, ['smoke test'])
  return { dim }
}

function folderSizeBytes(dir: Directory): number {
  let size = 0
  for (const entry of dir.list()) {
    size += entry instanceof Directory ? folderSizeBytes(entry) : entry.size
  }
  return size
}

export async function listInstalledLocal(): Promise<{ id: string; sizeBytes: number }[]> {
  const root = embeddersRoot()
  if (!root.exists) return []

  const installed: { id: string; sizeBytes: number }[] = []
  for (const entry of root.list()) {
    if (!(entry instanceof Directory)) continue
    if (!new File(entry, 'model.onnx').exists || !new File(entry, 'meta.json').exists) continue
    try {
      const meta = JSON.parse(await new File(entry, 'meta.json').text()) as { id: string }
      installed.push({ id: meta.id, sizeBytes: folderSizeBytes(entry) })
    } catch (error) {
      // A corrupt meta.json must not sink the whole list, but a model silently
      // vanishing from Settings needs to leave a trace.
      logger.warn('embedder.installed_entry_skipped', {
        dir: entry.name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return installed
}
