import * as React from 'react'
import { Platform, Pressable, ScrollView, View } from 'react-native'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

import {
  type DialogState,
  type ExecutionProvider,
  type FailReason,
  type FileProgress,
  type DialogDriver,
  type DialogInit,
  type DialogResolution,
  initialState,
  reducer,
} from './embedder-download-dialog-machine'

// Degenerate fallback when the host doesn't supply `availableEps`.
// Real hosts enumerate via the driver (platform detection + ORT
// build introspection). v1 always-works fallback is plain CPU.
const DEFAULT_AVAILABLE_EPS: readonly ExecutionProvider[] = ['cpu']

type EmbedderDownloadDialogViewProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  state: DialogState
  onAcceptLicense: () => void
  onDeclineLicense: () => void
  onSubmitHfInput: (id: string) => void
  onPickEp: (ep: ExecutionProvider) => void
  /** Confirms the staged EP from the ep-picker state (Continue
   * button). Distinct from `onPickEp` which only stages the
   * choice without advancing the state machine. */
  onContinueEp: () => void
  onConfirmImport: () => void
  onCancel: () => void
  onRetry: () => void
  onClose: () => void
  /** Optional named portal host. Routes the modal into a specific
   * `<PortalHost name={...} />` rather than the app-level default —
   * needed by Storybook's ThemeMatrix so each themed wrapper hosts
   * its own modal. */
  portalHost?: string
  /** Execution providers the host's platform / ORT build supports.
   * The dialog renders them as-is — no model-side filtering. Hosts
   * enumerate via the driver (platform detection + bundled ORT
   * introspection). Defaults to `['cpu']` if omitted, which yields
   * a degenerate single-option picker. */
  availableEps?: readonly ExecutionProvider[]
}

export function EmbedderDownloadDialogView(props: EmbedderDownloadDialogViewProps) {
  const { open, onOpenChange, state, portalHost } = props
  // hf-input value is view-local ephemera — the Footer's Resolve
  // button reads the same value HfInputBody types into. Once
  // onSubmitHfInput fires the host re-mounts the dialog with a
  // new init, so this state resets naturally.
  const [hfInputValue, setHfInputValue] = React.useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 560px overrides the primitive's sm:max-w-lg (≈512px) per
          the design spec: "560px-capped centered shape." */}
      <DialogContent className="sm:max-w-[560px]" portalHost={portalHost}>
        <Header state={state} onCancel={props.onCancel} />
        <Body {...props} hfInputValue={hfInputValue} onHfInputChange={setHfInputValue} />
        <Footer {...props} hfInputValue={hfInputValue} />
      </DialogContent>
    </Dialog>
  )
}

export type { EmbedderDownloadDialogViewProps }

function Header({ state, onCancel }: { state: DialogState; onCancel: () => void }) {
  const title = titleFor(state)
  const downloadingCancel = state.kind === 'downloading'
  return (
    <DialogHeader>
      <View className="flex-row items-center justify-between gap-2">
        <DialogTitle>{title}</DialogTitle>
        {downloadingCancel ? (
          <Pressable onPress={onCancel} hitSlop={8}>
            <Text variant="secondary" size="sm">
              Cancel
            </Text>
          </Pressable>
        ) : null}
      </View>
    </DialogHeader>
  )
}

function titleFor(state: DialogState): string {
  switch (state.kind) {
    case 'hf-input':
      return 'Install from HuggingFace'
    case 'resolving':
      return 'Resolving model…'
    case 'card-fetch':
      return `Install ${state.meta.displayName}`
    case 'license':
      return `Install ${state.meta.displayName}`
    case 'ep-picker':
      return `Pick execution provider — ${state.meta.displayName}`
    case 'import-confirm':
      return 'Import custom embedding model'
    case 'downloading':
      return `Downloading ${state.meta.displayName}`
    case 'verifying':
      return `Verifying ${state.meta.displayName}`
    case 'done':
      return `Installed ${state.meta.displayName}`
    case 'failed':
      return failedTitle(state.reason)
  }
}

// FailReason variants — sync with embedder-download-dialog-machine.ts.
function failedTitle(reason: FailReason): string {
  switch (reason.kind) {
    case 'cancelled':
      return 'Install cancelled'
    case 'card-fetch-failed':
      return '⚠ Couldn’t reach the model source'
    case 'resolve-failed':
      return '⚠ Couldn’t resolve model'
    case 'download-failed':
      return '⚠ Download failed'
    case 'validation-failed':
      return '⚠ Missing required files'
    case 'hash-mismatch':
      return '⚠ Verification failed'
    case 'smoke-test-failed':
      return '⚠ Execution provider not supported'
  }
}

function Body(
  props: EmbedderDownloadDialogViewProps & {
    hfInputValue: string
    onHfInputChange: (value: string) => void
  },
) {
  const { state } = props
  switch (state.kind) {
    case 'hf-input':
      return (
        <HfInputBody
          value={props.hfInputValue}
          onChange={props.onHfInputChange}
          onSubmit={props.onSubmitHfInput}
        />
      )
    case 'resolving':
      return <ResolvingBody />
    case 'card-fetch':
      return <CardFetchBody source={state.meta.source} />
    case 'license':
      return (
        <LicenseBody
          meta={state.meta}
          licenseText={state.licenseText}
          licenseName={state.licenseName}
        />
      )
    case 'ep-picker':
      return (
        <EpPickerBody
          pickedEp={state.pickedEp}
          onPick={props.onPickEp}
          availableEps={props.availableEps ?? DEFAULT_AVAILABLE_EPS}
        />
      )
    case 'import-confirm':
      return (
        <ImportConfirmBody
          availableEps={props.availableEps ?? DEFAULT_AVAILABLE_EPS}
          bundle={state.bundle}
          pickedEp={state.pickedEp}
          onPick={props.onPickEp}
        />
      )
    case 'downloading':
      return <DownloadingBody progressByFile={state.progressByFile} />
    case 'verifying':
      return <VerifyingBody verifyByFile={state.verifyByFile} />
    case 'done':
      return <DoneBody />
    case 'failed':
      return <FailedBody reason={state.reason} />
  }
}

function HfInputBody({
  value,
  onChange,
  onSubmit,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (id: string) => void
}) {
  return (
    <View className="gap-3">
      <Text variant="secondary" size="sm">
        Enter a HuggingFace model id (e.g. `namespace/model`) or paste a model URL.
      </Text>
      <Input
        placeholder="namespace/model"
        value={value}
        onChangeText={onChange}
        onSubmitEditing={() => onSubmit(value)}
      />
    </View>
  )
}

function ResolvingBody() {
  return (
    <View className="items-center gap-3 py-6">
      <Spinner />
      <Text variant="muted">Resolving model card and file listing…</Text>
    </View>
  )
}

function CardFetchBody({ source }: { source: string }) {
  return (
    <View className="items-center gap-3 py-6">
      <Spinner />
      <Text variant="muted">Fetching model card from {source}…</Text>
    </View>
  )
}

function LicenseBody({
  meta,
  licenseText,
  licenseName,
}: {
  meta: { source: string; revision: string; sizeBytes: number; fileCount: number }
  licenseText: string
  licenseName: string
}) {
  const sizeMb = (meta.sizeBytes / 1_000_000).toFixed(0)
  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text size="sm">
          <Text variant="muted">Source: </Text>
          {meta.source}
        </Text>
        <Text size="sm">
          <Text variant="muted">Revision: </Text>
          {meta.revision}
        </Text>
        <Text size="sm">
          <Text variant="muted">Size: </Text>
          {sizeMb} MB · {meta.fileCount} files
        </Text>
      </View>
      <Text size="sm" className="font-semibold">
        License — {licenseName || 'no license specified'}
      </Text>
      <ScrollView
        accessibilityLabel="License text"
        className={cn(
          'rounded-md border border-border bg-bg-sunken p-3',
          Platform.select({ web: 'max-h-[40vh]', default: 'max-h-96' }),
        )}
      >
        <Text size="sm" className="font-mono">
          {licenseText}
        </Text>
      </ScrollView>
      {!licenseName ? (
        <Text size="sm" variant="muted">
          ⚠ No license specified by the model author. Proceed at your own risk.
        </Text>
      ) : null}
    </View>
  )
}

// Shared EP picker row used by both EpPickerBody (HF-id flow's
// post-license step) and ImportConfirmBody (custom-import flow's
// confirmation step). Renders the canonical `[ <ep> ▾ ]` dropdown
// per the design spec, plus the warning copy from
// docs/memory/model-management.md → Custom file import. The host
// owns enumeration of platform-supported EPs; the dialog renders
// the list as-is without model-side filtering.
function EpSelectRow({
  pickedEp,
  onPick,
  availableEps,
}: {
  pickedEp: ExecutionProvider
  onPick: (ep: ExecutionProvider) => void
  availableEps: readonly ExecutionProvider[]
}) {
  const options: SelectOption[] = React.useMemo(
    () => availableEps.map((ep) => ({ value: ep, label: ep })),
    [availableEps],
  )
  return (
    <View className="gap-2">
      <Text size="sm" variant="muted">
        Execution provider
      </Text>
      {/* mode='radio' renders inline. The default auto-derivation
          would flip to 'dropdown' (→ bottom sheet on phone native),
          stacking a sheet on top of the dialog — discouraged by
          both iOS HIG and Material guidance on nested modals.
          Radio keeps the picker inside the modal's context on every
          tier. 3–4 EPs per platform max, so vertical space cost is
          modest. */}
      <Select
        options={options}
        value={pickedEp}
        onValueChange={onPick}
        mode="radio"
        label="Execution provider"
      />
      <Text size="sm" variant="muted">
        ⚠ Wrong choice may crash the app on next embed.
      </Text>
    </View>
  )
}

function EpPickerBody({
  pickedEp,
  onPick,
  availableEps,
}: {
  pickedEp: ExecutionProvider
  onPick: (ep: ExecutionProvider) => void
  availableEps: readonly ExecutionProvider[]
}) {
  return (
    <View className="gap-3">
      <Text variant="secondary" size="sm">
        Pick the execution provider this model will run under.
      </Text>
      <EpSelectRow pickedEp={pickedEp} onPick={onPick} availableEps={availableEps} />
    </View>
  )
}

function ImportConfirmBody({
  bundle,
  pickedEp,
  onPick,
  availableEps,
}: {
  bundle: { modelId: string; files: readonly { name: string; sizeBytes: number }[] }
  pickedEp: ExecutionProvider
  onPick: (ep: ExecutionProvider) => void
  availableEps: readonly ExecutionProvider[]
}) {
  return (
    <View className="gap-3">
      <Text variant="secondary" size="sm">
        You’re importing a custom model. By using it, you assert that you have a license to do so.
      </Text>
      <View className="gap-1">
        <Text size="sm">
          <Text variant="muted">Model id: </Text>
          {bundle.modelId}
        </Text>
        <Text size="sm" variant="muted">
          Files:
        </Text>
        {bundle.files.map((f) => (
          <Text key={f.name} size="sm">
            · {f.name} ({(f.sizeBytes / 1_000_000).toFixed(1)} MB)
          </Text>
        ))}
      </View>
      <EpSelectRow pickedEp={pickedEp} onPick={onPick} availableEps={availableEps} />
    </View>
  )
}

function DownloadingBody({ progressByFile }: { progressByFile: Record<string, FileProgress> }) {
  const entries = Object.entries(progressByFile)
  const total = entries.reduce(
    (acc, [, p]) => {
      if (p.kind === 'downloading')
        return { received: acc.received + p.bytesReceived, total: acc.total + p.bytesTotal }
      return acc
    },
    { received: 0, total: 0 },
  )
  return (
    <View className="gap-3">
      {entries.map(([file, progress]) => (
        <View key={file} className="gap-1">
          <View className="flex-row justify-between">
            <Text size="sm">{file}</Text>
            <Text size="sm" variant="muted">
              {progress.kind === 'waiting' && 'waiting…'}
              {progress.kind === 'downloading' &&
                `${Math.round((progress.bytesReceived / progress.bytesTotal) * 100)}%`}
              {progress.kind === 'done' && 'done'}
            </Text>
          </View>
          <View className="h-1 rounded-full bg-bg-sunken">
            <View
              className="h-1 rounded-full bg-accent"
              style={{
                width:
                  progress.kind === 'downloading'
                    ? `${(progress.bytesReceived / progress.bytesTotal) * 100}%`
                    : progress.kind === 'done'
                      ? '100%'
                      : '0%',
              }}
            />
          </View>
        </View>
      ))}
      {total.total > 0 ? (
        <Text size="sm" variant="muted">
          Total: {(total.received / 1_000_000).toFixed(1)} / {(total.total / 1_000_000).toFixed(1)}{' '}
          MB
        </Text>
      ) : null}
    </View>
  )
}

function VerifyingBody({
  verifyByFile,
}: {
  verifyByFile: Record<string, 'pending' | 'ok' | 'fail'>
}) {
  const entries = Object.entries(verifyByFile)
  return (
    <View className="gap-2">
      {entries.map(([file, status]) => (
        <View key={file} className="flex-row items-center gap-2">
          <Text>
            {status === 'ok' && '✓ '}
            {status === 'fail' && '✗ '}
            {status === 'pending' && '… '}
            {file}
          </Text>
          <Text variant="muted" size="sm">
            {status === 'ok' && 'hash matches'}
            {status === 'fail' && 'sha256 mismatch'}
            {status === 'pending' && 'verifying…'}
          </Text>
        </View>
      ))}
    </View>
  )
}

function DoneBody() {
  return (
    <View className="items-center gap-2 py-4">
      <Text>Done.</Text>
    </View>
  )
}

// 'cancelled' is its own FailReason variant per the state-machine
// refactor — no more sentinel string check inside card-fetch-failed.
function FailedBody({ reason }: { reason: FailReason }) {
  switch (reason.kind) {
    case 'cancelled':
      return <Text variant="muted">The install was cancelled. No files were written to disk.</Text>
    case 'card-fetch-failed':
      return (
        <View className="gap-2">
          <Text>The model-card fetch failed:</Text>
          <Text className="font-mono" size="sm">
            {reason.message}
          </Text>
          <Text variant="muted" size="sm">
            The license is fetched live to defend against post-curation edits — we can’t proceed
            with a cached copy. Check your connection and try again.
          </Text>
        </View>
      )
    case 'resolve-failed':
      return (
        <View className="gap-2">
          <Text>Couldn’t resolve the HF model:</Text>
          <Text className="font-mono" size="sm">
            {reason.message}
          </Text>
        </View>
      )
    case 'download-failed':
      return (
        <View className="gap-2">
          <Text>A file failed to download:</Text>
          <Text size="sm">
            <Text variant="muted">{reason.failingFile}: </Text>
            {reason.message}
          </Text>
          <Text variant="muted" size="sm">
            The partial install has been discarded. Close this dialog and try again from the picker
            when the network is back.
          </Text>
        </View>
      )
    case 'validation-failed':
      return (
        <View className="gap-2">
          <Text>This model doesn’t have the required ONNX exports.</Text>
          <Text variant="muted" size="sm">
            Missing: {reason.missingFiles.join(', ')}
          </Text>
          <Text variant="muted" size="sm">
            Some HF models ship in Python-only formats (PyTorch / safetensors). Check the model card
            for ONNX export instructions, or try the curated catalog.
          </Text>
        </View>
      )
    case 'hash-mismatch':
      return (
        <View className="gap-2">
          <Text>One of the downloaded files doesn’t match the expected hash:</Text>
          <Text size="sm">✗ {reason.failingFile} sha256 mismatch</Text>
          <Text variant="muted" size="sm">
            This may indicate a corrupted download or an upstream change the bundled catalog hasn’t
            caught up to. The partial install has been deleted.
          </Text>
        </View>
      )
    case 'smoke-test-failed':
      return (
        <View className="gap-2">
          <Text>The smoke-test embed crashed under {reason.ep}.</Text>
          <Text variant="muted" size="sm">
            Try a different execution provider, or check the model card for EP support notes.
          </Text>
        </View>
      )
  }
}

// 'cancelled' reason is its own FailReason variant (not a sentinel
// on card-fetch-failed.message anymore); retry only applies to
// the network/resolve failure paths that are actually retryable.
function Footer(props: EmbedderDownloadDialogViewProps & { hfInputValue: string }) {
  const { state } = props
  switch (state.kind) {
    case 'hf-input':
      return (
        <DialogFooter>
          <Button variant="secondary" onPress={props.onCancel}>
            <Text>Cancel</Text>
          </Button>
          <Button variant="primary" onPress={() => props.onSubmitHfInput(props.hfInputValue)}>
            <Text>Resolve</Text>
          </Button>
        </DialogFooter>
      )
    case 'resolving':
    case 'card-fetch':
      return (
        <DialogFooter>
          <Button variant="secondary" onPress={props.onCancel}>
            <Text>Cancel</Text>
          </Button>
        </DialogFooter>
      )
    case 'license':
      return (
        <DialogFooter>
          <Button variant="secondary" onPress={props.onDeclineLicense}>
            <Text>Decline</Text>
          </Button>
          <Button variant="primary" onPress={props.onAcceptLicense}>
            <Text>Accept & download</Text>
          </Button>
        </DialogFooter>
      )
    case 'ep-picker':
      return (
        <DialogFooter>
          <Button variant="secondary" onPress={props.onCancel}>
            <Text>Cancel</Text>
          </Button>
          <Button variant="primary" onPress={props.onContinueEp}>
            <Text>Continue</Text>
          </Button>
        </DialogFooter>
      )
    case 'import-confirm':
      return (
        <DialogFooter>
          <Button variant="secondary" onPress={props.onCancel}>
            <Text>Cancel</Text>
          </Button>
          <Button variant="primary" onPress={props.onConfirmImport}>
            <Text>Import</Text>
          </Button>
        </DialogFooter>
      )
    case 'downloading':
    case 'verifying':
    case 'done':
      return null
    case 'failed': {
      const retryable =
        state.reason.kind === 'card-fetch-failed' || state.reason.kind === 'resolve-failed'
      if (retryable) {
        return (
          <DialogFooter>
            <Button variant="secondary" onPress={props.onCancel}>
              <Text>Cancel</Text>
            </Button>
            <Button variant="primary" onPress={props.onRetry}>
              <Text>Retry</Text>
            </Button>
          </DialogFooter>
        )
      }
      return (
        <DialogFooter>
          <Button variant="primary" onPress={props.onClose}>
            <Text>Close</Text>
          </Button>
        </DialogFooter>
      )
    }
  }
}

type EmbedderDownloadDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  init: DialogInit
  driver: DialogDriver
  onResolve: (result: DialogResolution) => void
}

export function EmbedderDownloadDialog(props: EmbedderDownloadDialogProps) {
  const { open, onOpenChange, init, driver, onResolve } = props
  const [state, dispatch] = React.useReducer(reducer, init, initialState)
  const resolvedRef = React.useRef(false)
  const lastUserActionRef = React.useRef<'declined' | 'cancelled' | null>(null)

  // card-fetch effect: fires driver.fetchModelCard, dispatches result.
  // Cancellation is best-effort — if state moves away mid-flight,
  // the dispatched action lands on a stale state and is ignored.
  React.useEffect(() => {
    if (state.kind !== 'card-fetch') return
    if (init.kind !== 'catalog') return
    let cancelled = false
    driver
      .fetchModelCard({ kind: 'catalog', entry: init.entry })
      .then((res) => {
        if (cancelled) return
        dispatch({
          type: 'card-fetched',
          meta: res.meta,
          licenseText: res.licenseText,
          licenseName: res.licenseName,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'card-fetch-failed', message })
      })
    return () => {
      cancelled = true
    }
  }, [state.kind, driver, init])

  // resolving effect (HF id path): fetch model card live from HF id.
  // Extract the HF id input from the narrowed resolving state so the
  // dep array references a stable primitive rather than the full state
  // object (which is recreated on every dispatch). The effect uses
  // resolvingHfInput directly — null acts as the early-return guard.
  const resolvingHfInput =
    state.kind === 'resolving' && state.init.kind === 'hf-id' ? state.init.input : null
  React.useEffect(() => {
    if (resolvingHfInput === null) return
    const id = resolvingHfInput
    let cancelled = false
    driver
      .fetchModelCard({ kind: 'hf-id', id })
      .then((res) => {
        if (cancelled) return
        dispatch({
          type: 'card-fetched',
          meta: res.meta,
          licenseText: res.licenseText,
          licenseName: res.licenseName,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'card-fetch-failed', message })
      })
    return () => {
      cancelled = true
    }
  }, [driver, resolvingHfInput])

  // downloading effect: iterate files in meta.fileCount + the catalog
  // entry. The container holds the file list via init; production
  // driver wires real URLs and target paths. Stub-driver-friendly:
  // never-resolving promises just leave state in 'downloading'.
  React.useEffect(() => {
    if (state.kind !== 'downloading') return
    if (init.kind !== 'catalog') return
    let cancelled = false
    const files = init.entry.files
    void (async () => {
      let currentFile = ''
      try {
        for (const file of files) {
          if (cancelled) return
          currentFile = file
          await driver.downloadFile({
            url: `${init.entry.source}/resolve/${init.entry.revision}/${file}`,
            targetPath: file,
            onProgress: (bytesReceived, bytesTotal) => {
              if (cancelled) return
              dispatch({ type: 'download-progress', file, bytesReceived, bytesTotal })
            },
          })
          if (cancelled) return
          dispatch({ type: 'download-complete', file })
        }
        if (cancelled) return
        dispatch({ type: 'all-downloaded' })
      } catch (err: unknown) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'download-failed', file: currentFile, message })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [state.kind, driver, init])

  // verifying effect: SHA256 each file; compare to expectedSha256
  // from the catalog entry (curated path) or just compute (HF id /
  // import paths).
  React.useEffect(() => {
    if (state.kind !== 'verifying') return
    if (init.kind !== 'catalog') return
    let cancelled = false
    const files = init.entry.files
    const expected = init.entry.expectedSha256
    void (async () => {
      for (const file of files) {
        if (cancelled) return
        try {
          const hash = await driver.computeSha256(file)
          if (cancelled) return
          const expectedHash = expected[file]
          if (expectedHash && hash !== expectedHash) {
            dispatch({ type: 'verify-failed', file })
            return
          }
          dispatch({ type: 'verify-progress', file, result: 'ok' })
        } catch {
          if (cancelled) return
          dispatch({ type: 'verify-failed', file })
          return
        }
      }
      if (cancelled) return
      dispatch({ type: 'all-verified' })
    })()
    return () => {
      cancelled = true
    }
  }, [state.kind, driver, init])

  const computeResolution = (s: DialogState): DialogResolution | null => {
    if (s.kind === 'done') {
      return lastUserActionRef.current === 'declined'
        ? { kind: 'declined' }
        : { kind: 'installed', meta: s.meta }
    }
    if (s.kind === 'failed') {
      return s.reason.kind === 'cancelled'
        ? { kind: 'cancelled' }
        : { kind: 'error', reason: s.reason }
    }
    return null
  }

  const fireResolveOnce = (res: DialogResolution) => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    onResolve(res)
  }

  // Auto-fire terminal observer: 'done' and 'failed { cancelled }'
  // resolve immediately. Other failed states wait for user dismissal
  // so the FailedBody has a chance to be read.
  React.useEffect(() => {
    if (resolvedRef.current) return
    if (state.kind === 'done') {
      const res = computeResolution(state)
      if (res) fireResolveOnce(res)
    } else if (state.kind === 'failed' && state.reason.kind === 'cancelled') {
      fireResolveOnce({ kind: 'cancelled' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, onResolve])

  // Dismissal wrap: every dismissal vector (Escape, overlay click,
  // corner ×, Cancel/Decline/Close buttons) routes through here.
  // - Already-resolved: bubble to host, do nothing else.
  // - Terminal failed (non-cancelled): user reviewed the error, fire
  //   error resolution and bubble.
  // - Non-terminal license: treat as declined; reducer transitions
  //   to 'done' and the terminal observer fires 'declined'.
  // - Non-terminal other: treat as cancelled; reducer transitions
  //   to 'failed { cancelled }' and the terminal observer fires.
  const handleOpenChange = (next: boolean) => {
    if (!next && !resolvedRef.current) {
      if (state.kind === 'failed') {
        const res = computeResolution(state)
        if (res) fireResolveOnce(res)
      } else if (state.kind === 'license') {
        lastUserActionRef.current = 'declined'
        dispatch({ type: 'license-declined' })
      } else if (state.kind !== 'done') {
        lastUserActionRef.current = 'cancelled'
        dispatch({ type: 'cancel' })
      }
    }
    onOpenChange(next)
  }

  return (
    <EmbedderDownloadDialogView
      open={open}
      onOpenChange={handleOpenChange}
      state={state}
      onAcceptLicense={() => dispatch({ type: 'license-accepted' })}
      onDeclineLicense={() => handleOpenChange(false)}
      onSubmitHfInput={(input) => dispatch({ type: 'submit-hf-input', input })}
      onPickEp={(ep) => dispatch({ type: 'ep-picked', ep })}
      onContinueEp={() => dispatch({ type: 'ep-confirmed' })}
      onConfirmImport={() => dispatch({ type: 'license-accepted' })}
      onCancel={() => handleOpenChange(false)}
      onRetry={() => dispatch({ type: 'retry' })}
      onClose={() => handleOpenChange(false)}
    />
  )
}

export type { EmbedderDownloadDialogProps }
