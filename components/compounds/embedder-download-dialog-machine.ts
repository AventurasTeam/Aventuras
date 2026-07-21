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

/**
 * What the license region shows: `license` — real license text (standard HF
 * tags resolved via the pinned choosealicense dataset); `model-card` — README
 * fallback for proprietary/unknown tags with no standard text.
 */
export type LicenseKind = 'license' | 'model-card'

export type FileProgress =
  | { kind: 'waiting' }
  | { kind: 'downloading'; bytesReceived: number; bytesTotal: number }
  // bytesTotal is preserved from the downloading entry so completed files keep
  // counting toward the persistent received/total line.
  | { kind: 'done'; bytesTotal?: number }

export type FailReason =
  | { kind: 'cancelled' }
  | { kind: 'card-fetch-failed'; message: string }
  | { kind: 'resolve-failed'; message: string }
  | { kind: 'download-failed'; failingFile: string; message: string }
  | { kind: 'validation-failed'; missingFiles: string[] }
  | { kind: 'hash-mismatch'; failingFile: string }
  | { kind: 'smoke-test-failed'; ep: ExecutionProvider }
  | { kind: 'persist-failed'; message: string }

export type DialogInit =
  | { kind: 'catalog'; entry: CatalogEntry }
  | { kind: 'hf-id'; input: string }
  | { kind: 'import'; files: ImportBundle; ep: ExecutionProvider }

export type DialogState =
  // 'hf-input' transitions to 'resolving' on submit-hf-input.
  // No other reducer exit — the dialog re-opens with a new init
  // if the host wants to reset.
  | { kind: 'hf-input' }
  // 'ep-picker' is reserved for the HF id flow's post-license step
  // (per spec "EP picker appears as a final step before download").
  // No reducer transition currently enters it; arrives when HF id
  // driver wiring lands and inserts license → ep-picker → downloading.
  | { kind: 'resolving'; init: DialogInit }
  | { kind: 'card-fetch'; meta: ModelMeta }
  | {
      kind: 'license'
      meta: ModelMeta
      licenseText: string
      licenseName: string
      licenseKind: LicenseKind
      licenseLink?: string
    }
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
  | { type: 'submit-hf-input'; input: string }
  | {
      type: 'card-fetched'
      meta: ModelMeta
      licenseText: string
      licenseName: string
      licenseKind: LicenseKind
      licenseLink?: string
    }
  | { type: 'card-fetch-failed'; message: string }
  | { type: 'license-accepted' }
  | { type: 'license-declined' }
  // 'ep-picked' stages a new pickedEp on the current state without
  // transitioning. 'ep-confirmed' is the explicit transition out of
  // 'ep-picker' to 'downloading' — fired by the Continue button.
  // (For 'import-confirm' the Import button fires 'license-accepted'.)
  | { type: 'ep-picked'; ep: ExecutionProvider }
  | { type: 'ep-confirmed' }
  // Seeds every planned file as 'waiting' when the download phase starts, so
  // the dialog lists the full manifest before the first byte arrives.
  | { type: 'files-planned'; files: readonly string[] }
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
  | { type: 'smoke-test-failed'; ep: ExecutionProvider }
  | { type: 'persist-failed'; message: string }
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
  ): Promise<{
    meta: ModelMeta
    licenseText: string
    licenseName: string
    licenseKind: LicenseKind
    licenseLink?: string
  }>
  resolveHfModel(id: string): Promise<{ meta: ModelMeta; files: string[] }>
  downloadFile(args: {
    url: string
    targetPath: string
    onProgress: (bytesReceived: number, bytesTotal: number) => void
  }): Promise<void>
  computeSha256(filePath: string): Promise<string>
  // Stops the transfer itself, not just its reporting. Callers must await this
  // and the in-flight downloadFile before deletePartial, or the cleanup races
  // a live writer.
  cancelDownload(): Promise<void>
  // No path/id argument on either: a driver instance is created per dialog open
  // and closes over the catalog entry it was opened for.
  smokeTestEmbed(args: { ep: ExecutionProvider }): Promise<void>
  persistInstall(args: { meta: ModelMeta; licenseText: string }): Promise<void>
  deletePartial(): Promise<void>
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
          licenseKind: action.licenseKind,
          licenseLink: action.licenseLink,
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
          licenseKind: action.licenseKind,
          licenseLink: action.licenseLink,
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
        // Stage the new EP. Continue button confirms via 'ep-confirmed'.
        return { ...state, pickedEp: action.ep }
      }
      if (action.type === 'ep-confirmed') {
        return { kind: 'downloading', meta: state.meta, progressByFile: {} }
      }
      return state
    }
    case 'import-confirm': {
      if (action.type === 'ep-picked') {
        // Stage the new EP. Import button confirms via 'license-accepted'.
        return { ...state, pickedEp: action.ep }
      }
      if (action.type === 'license-accepted') {
        // Container reuses 'license-accepted' as the import-confirm Import
        // CTA — semantic is the same (proceed past confirmation). Files
        // are local, so we skip downloading and go straight to verifying.
        return { kind: 'verifying', meta: bundleToMeta(state.bundle), verifyByFile: {} }
      }
      return state
    }
    case 'downloading': {
      if (action.type === 'files-planned') {
        const progressByFile = { ...state.progressByFile }
        for (const file of action.files) progressByFile[file] ??= { kind: 'waiting' }
        return { ...state, progressByFile }
      }
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
        const prior = state.progressByFile[action.file]
        return {
          ...state,
          progressByFile: {
            ...state.progressByFile,
            [action.file]: {
              kind: 'done',
              bytesTotal: prior?.kind === 'downloading' ? prior.bytesTotal : undefined,
            },
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
          reason: { kind: 'download-failed', failingFile: action.file, message: action.message },
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
      if (action.type === 'smoke-test-failed') {
        return {
          kind: 'failed',
          meta: state.meta,
          reason: { kind: 'smoke-test-failed', ep: action.ep },
        }
      }
      if (action.type === 'persist-failed') {
        return {
          kind: 'failed',
          meta: state.meta,
          reason: { kind: 'persist-failed', message: action.message },
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
        // Restarts the manifest; already-staged bytes survive per platform
        // (desktop resumes .part via Range, native restarts the failed file).
        if (state.reason.kind === 'download-failed' && state.meta) {
          return { kind: 'downloading', meta: state.meta, progressByFile: {} }
        }
      }
      return state
    }
    case 'hf-input': {
      if (action.type === 'submit-hf-input') {
        return { kind: 'resolving', init: { kind: 'hf-id', input: action.input } }
      }
      return state
    }
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
  cancelDownload: () => Promise.resolve(),
  smokeTestEmbed: () => new Promise(() => {}),
  persistInstall: () => new Promise(() => {}),
  deletePartial: () => new Promise(() => {}),
}
