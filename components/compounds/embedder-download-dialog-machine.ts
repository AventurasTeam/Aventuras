// Placeholder types — refined when real driver implementations land.
// CatalogEntry / ImportBundle reflect the dialog's input shape only.
// ExecutionProvider is the platform-specific ONNX runtime EP label.
export type ExecutionProvider = string

export type CatalogEntry = {
  id: string
  displayName: string
  source: string
  revision: string
  sizeBytes: number
  files: readonly string[]
  expectedSha256: Readonly<Record<string, string>>
}

export type ImportBundle = {
  modelId: string
  files: readonly { name: string; path: string; sizeBytes: number }[]
}

export type ModelMeta = {
  displayName: string
  source: string
  revision: string
  sizeBytes: number
  fileCount: number
}

export type FileProgress =
  | { kind: 'waiting' }
  | { kind: 'downloading'; bytesReceived: number; bytesTotal: number }
  | { kind: 'done' }

export type FailReason =
  | { kind: 'cancelled' }
  | { kind: 'card-fetch-failed'; message: string }
  | { kind: 'resolve-failed'; message: string }
  | { kind: 'validation-failed'; missingFiles: string[] }
  | { kind: 'hash-mismatch'; failingFile: string }
  | { kind: 'smoke-test-failed'; ep: ExecutionProvider }

export type DialogInit =
  | { kind: 'catalog'; entry: CatalogEntry }
  | { kind: 'hf-id'; input: string }
  | { kind: 'import'; files: ImportBundle; ep: ExecutionProvider }

export type DialogState =
  // 'hf-input' is a sink state in the reducer — the only exit is host
  // closing the dialog and re-opening with a new DialogInit. Submitting
  // an input changes `init` at the host layer.
  | { kind: 'hf-input' }
  // 'ep-picker' is reserved for the HF id flow's post-license step
  // (per spec "EP picker appears as a final step before download").
  // No reducer transition currently enters it; arrives when HF id
  // driver wiring lands and inserts license → ep-picker → downloading.
  | { kind: 'resolving'; init: DialogInit }
  | { kind: 'card-fetch'; meta: ModelMeta }
  | { kind: 'license'; meta: ModelMeta; licenseText: string; licenseName: string }
  | { kind: 'ep-picker'; meta: ModelMeta; pickedEp: ExecutionProvider }
  | { kind: 'import-confirm'; bundle: ImportBundle; pickedEp: ExecutionProvider }
  | {
      kind: 'downloading'
      meta: ModelMeta
      progressByFile: Record<string, FileProgress>
    }
  | {
      kind: 'verifying'
      meta: ModelMeta
      verifyByFile: Record<string, 'pending' | 'ok' | 'fail'>
    }
  | { kind: 'done'; meta: ModelMeta }
  | { kind: 'failed'; meta: ModelMeta | null; reason: FailReason }

export type DialogAction =
  | { type: 'card-fetched'; meta: ModelMeta; licenseText: string; licenseName: string }
  | { type: 'card-fetch-failed'; message: string }
  | { type: 'license-accepted' }
  | { type: 'license-declined' }
  | { type: 'ep-picked'; ep: ExecutionProvider }
  | {
      type: 'download-progress'
      file: string
      bytesReceived: number
      bytesTotal: number
    }
  | { type: 'download-complete'; file: string }
  | { type: 'all-downloaded' }
  | { type: 'download-failed'; file: string; message: string }
  | { type: 'verify-progress'; file: string; result: 'ok' | 'fail' }
  | { type: 'all-verified' }
  | { type: 'verify-failed'; file: string }
  | { type: 'cancel' }
  | { type: 'retry' }
  | { type: 'close' }

export type DialogResolution =
  | { kind: 'installed'; meta: ModelMeta }
  | { kind: 'declined' }
  | { kind: 'cancelled' }
  | { kind: 'error'; reason: FailReason }

export type DialogDriver = {
  fetchModelCard(
    source: { kind: 'catalog'; entry: CatalogEntry } | { kind: 'hf-id'; id: string },
  ): Promise<{ meta: ModelMeta; licenseText: string; licenseName: string }>
  resolveHfModel(id: string): Promise<{ meta: ModelMeta; files: string[] }>
  downloadFile(args: {
    url: string
    targetPath: string
    onProgress: (bytesReceived: number, bytesTotal: number) => void
  }): Promise<void>
  computeSha256(filePath: string): Promise<string>
  smokeTestEmbed(args: { modelDir: string; ep: ExecutionProvider }): Promise<void>
  persistInstall(args: { meta: ModelMeta; files: string[]; licenseText: string }): Promise<void>
  deletePartial(modelDir: string): Promise<void>
}

export function initialState(init: DialogInit): DialogState {
  switch (init.kind) {
    case 'catalog': {
      const { entry } = init
      return {
        kind: 'card-fetch',
        meta: {
          displayName: entry.displayName,
          source: entry.source,
          revision: entry.revision,
          sizeBytes: entry.sizeBytes,
          fileCount: entry.files.length,
        },
      }
    }
    case 'hf-id':
      return init.input.length === 0 ? { kind: 'hf-input' } : { kind: 'resolving', init }
    case 'import':
      return { kind: 'import-confirm', bundle: init.files, pickedEp: init.ep }
  }
}

export function reducer(state: DialogState, action: DialogAction): DialogState {
  if (action.type === 'close') return state

  if (action.type === 'cancel') {
    if (state.kind === 'done' || state.kind === 'failed') return state
    const meta = 'meta' in state ? (state.meta ?? null) : null
    return {
      kind: 'failed',
      meta,
      reason: { kind: 'cancelled' },
    }
  }

  switch (state.kind) {
    case 'card-fetch': {
      if (action.type === 'card-fetched') {
        return {
          kind: 'license',
          meta: action.meta,
          licenseText: action.licenseText,
          licenseName: action.licenseName,
        }
      }
      if (action.type === 'card-fetch-failed') {
        return {
          kind: 'failed',
          meta: state.meta,
          reason: { kind: 'card-fetch-failed', message: action.message },
        }
      }
      return state
    }
    case 'resolving': {
      if (action.type === 'card-fetched') {
        return {
          kind: 'license',
          meta: action.meta,
          licenseText: action.licenseText,
          licenseName: action.licenseName,
        }
      }
      if (action.type === 'card-fetch-failed') {
        return {
          kind: 'failed',
          meta: null,
          reason: { kind: 'resolve-failed', message: action.message },
        }
      }
      return state
    }
    case 'license': {
      if (action.type === 'license-accepted') {
        return { kind: 'downloading', meta: state.meta, progressByFile: {} }
      }
      if (action.type === 'license-declined') {
        // Decline routes through 'done' (no separate 'declined' state).
        // The container tracks the dispatched action via a ref and maps
        // done-after-decline → DialogResolution { kind: 'declined' }.
        return { kind: 'done', meta: state.meta }
      }
      return state
    }
    case 'ep-picker': {
      if (action.type === 'ep-picked') {
        return { kind: 'downloading', meta: state.meta, progressByFile: {} }
      }
      return state
    }
    case 'import-confirm': {
      if (action.type === 'license-accepted') {
        // Container reuses 'license-accepted' as the import-confirm Import
        // CTA — semantic is the same (proceed past confirmation). Files
        // are local, so we skip downloading and go straight to verifying.
        return { kind: 'verifying', meta: bundleToMeta(state.bundle), verifyByFile: {} }
      }
      return state
    }
    case 'downloading': {
      if (action.type === 'download-progress') {
        return {
          ...state,
          progressByFile: {
            ...state.progressByFile,
            [action.file]: {
              kind: 'downloading',
              bytesReceived: action.bytesReceived,
              bytesTotal: action.bytesTotal,
            },
          },
        }
      }
      if (action.type === 'download-complete') {
        return {
          ...state,
          progressByFile: {
            ...state.progressByFile,
            [action.file]: { kind: 'done' },
          },
        }
      }
      if (action.type === 'all-downloaded') {
        const verifyByFile: Record<string, 'pending' | 'ok' | 'fail'> = {}
        for (const file of Object.keys(state.progressByFile)) verifyByFile[file] = 'pending'
        return { kind: 'verifying', meta: state.meta, verifyByFile }
      }
      if (action.type === 'download-failed') {
        return {
          kind: 'failed',
          meta: state.meta,
          reason: { kind: 'card-fetch-failed', message: `${action.file}: ${action.message}` },
        }
      }
      return state
    }
    case 'verifying': {
      if (action.type === 'verify-progress') {
        return {
          ...state,
          verifyByFile: { ...state.verifyByFile, [action.file]: action.result },
        }
      }
      if (action.type === 'all-verified') {
        return { kind: 'done', meta: state.meta }
      }
      if (action.type === 'verify-failed') {
        return {
          kind: 'failed',
          meta: state.meta,
          reason: { kind: 'hash-mismatch', failingFile: action.file },
        }
      }
      return state
    }
    case 'failed': {
      if (action.type === 'retry') {
        if (state.reason.kind === 'card-fetch-failed' && state.meta) {
          return { kind: 'card-fetch', meta: state.meta }
        }
        if (state.reason.kind === 'resolve-failed') {
          return { kind: 'hf-input' }
        }
      }
      return state
    }
    case 'hf-input':
    case 'done':
      return state
    default: {
      const _exhaustive: never = state
      return _exhaustive
    }
  }
}

function bundleToMeta(bundle: ImportBundle): ModelMeta {
  const total = bundle.files.reduce((acc, f) => acc + f.sizeBytes, 0)
  return {
    displayName: bundle.modelId,
    source: 'custom-import',
    revision: 'n/a',
    sizeBytes: total,
    fileCount: bundle.files.length,
  }
}

export const stubDriver: DialogDriver = {
  fetchModelCard: () => new Promise(() => {}),
  resolveHfModel: () => new Promise(() => {}),
  downloadFile: () => new Promise(() => {}),
  computeSha256: () => new Promise(() => {}),
  smokeTestEmbed: () => new Promise(() => {}),
  persistInstall: () => new Promise(() => {}),
  deletePartial: () => new Promise(() => {}),
}
