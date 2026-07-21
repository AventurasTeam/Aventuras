import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { Linking, Platform, ScrollView, View } from 'react-native'

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
import { logger } from '@/lib/diagnostics'
import { useTheme } from '@/lib/themes'
import { cn } from '@/lib/utils'

import {
  type DialogDriver,
  type DialogInit,
  type DialogResolution,
  type DialogState,
  type ExecutionProvider,
  type FailReason,
  type FileProgress,
  type LicenseKind,
  initialState,
  reducer,
} from './embedder-download-dialog-machine'
import ModelCardDocument from './model-card-document'

// Fallback when the host doesn't supply `availableEps`.
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
  const [hfInputValue, setHfInputValue] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 560px overrides the primitive's sm:max-w-lg (≈512px) per
          the design spec: "560px-capped centered shape." */}
      {/* No header ×: every state carries an explicit affordance, and a header
          close would bypass the machine's cancel path (partial-file cleanup). */}
      <DialogContent className="sm:max-w-[560px]" portalHost={portalHost} hideCloseButton>
        <Header state={state} />
        <Body {...props} hfInputValue={hfInputValue} onHfInputChange={setHfInputValue} />
        <Footer {...props} hfInputValue={hfInputValue} />
      </DialogContent>
    </Dialog>
  )
}

export type { EmbedderDownloadDialogViewProps }

function Header({ state }: { state: DialogState }) {
  return (
    <DialogHeader>
      <DialogTitle>{titleFor(state)}</DialogTitle>
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
    case 'persist-failed':
      return '⚠ Couldn’t save the installed model'
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
          licenseKind={state.licenseKind}
          licenseLink={state.licenseLink}
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
      return (
        <DownloadingBody progressByFile={state.progressByFile} totalBytes={state.meta.sizeBytes} />
      )
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

// Model cards are markdown + embedded HTML; standard license text stays in the
// mono ScrollView above because markdown rendering would reflow its
// hard-wrapped plain text. The WebView owns its scrolling on native, so the
// fixed height replaces the ScrollView's max-height.
function ModelCardRegion({ markdown, sourceUrl }: { markdown: string; sourceUrl: string }) {
  const { theme } = useTheme()
  // Native WebView boot takes seconds; overlay a spinner until the document
  // reports its first paint (reader pattern). Web renders inline — no boot.
  const [painted, setPainted] = useState(Platform.OS === 'web')
  const handleFirstPaint = useCallback(() => setPainted(true), [])
  // Allow only the document's own initial load (reader pattern); link taps
  // route through onOpenLink instead of navigating the WebView.
  const documentUrlRef = useRef<string | null>(null)
  const handleShouldStartLoad = useCallback((request: { url: string }) => {
    if (documentUrlRef.current != null) return request.url === documentUrlRef.current
    if (/^(file:|about:|https?:\/\/localhost[:/])/i.test(request.url)) {
      documentUrlRef.current = request.url
      return true
    }
    return false
  }, [])
  const openLink = useCallback((url: string) => {
    // Relative hrefs are resolved document-side against sourceUrl; anything
    // that still isn't http(s) here (mailto:, malformed) is dropped.
    if (/^https?:\/\//i.test(url)) void Linking.openURL(url)
  }, [])
  return (
    <View
      className={cn(
        'relative overflow-hidden rounded-md border border-border bg-bg-sunken',
        Platform.select({ web: 'h-[40vh]', default: 'h-96' }),
      )}
    >
      <ModelCardDocument
        markdown={markdown}
        themeId={theme.id}
        hostIsWebView={Platform.OS !== 'web'}
        linkBase={sourceUrl.endsWith('/') ? sourceUrl : `${sourceUrl}/`}
        onOpenLink={openLink}
        onFirstPaint={handleFirstPaint}
        dom={{
          scrollEnabled: false,
          style: { flex: 1 },
          onShouldStartLoadWithRequest: handleShouldStartLoad,
        }}
      />
      {!painted ? (
        <View className="absolute inset-0 items-center justify-center">
          <Spinner />
        </View>
      ) : null}
    </View>
  )
}

function LicenseBody({
  meta,
  licenseText,
  licenseName,
  licenseKind,
  licenseLink,
}: {
  meta: { source: string; revision: string; sizeBytes: number; fileCount: number }
  licenseText: string
  licenseName: string
  licenseKind: LicenseKind
  licenseLink?: string
}) {
  const sizeMb = (meta.sizeBytes / 1_000_000).toFixed(0)
  const isModelCard = licenseKind === 'model-card'
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
        {isModelCard
          ? `Model card — license: ${licenseName || 'unspecified'}`
          : `License — ${licenseName || 'no license specified'}`}
      </Text>
      {isModelCard ? (
        <ModelCardRegion markdown={licenseText} sourceUrl={meta.source} />
      ) : (
        <ScrollView
          accessibilityLabel="License text"
          className={cn(
            'rounded-md border border-border bg-bg-sunken',
            Platform.select({ web: 'max-h-[40vh]', default: 'max-h-96' }),
          )}
          // Padding must live on the content container: on the scroll container
          // itself, Android clips the scrollable extent by the padding and the
          // content tail becomes unreachable.
          contentContainerClassName="p-3"
        >
          <Text size="sm" className="font-mono">
            {licenseText}
          </Text>
        </ScrollView>
      )}
      {isModelCard && licenseName ? (
        <Text size="sm" variant="muted">
          No standard text exists for this license — the model card is shown instead. Review the
          license at the source before accepting.
          {licenseLink ? (
            <>
              {' '}
              <Text
                size="sm"
                className="text-accent underline"
                accessibilityRole="link"
                onPress={() => void Linking.openURL(licenseLink)}
              >
                View license terms
              </Text>
            </>
          ) : null}
        </Text>
      ) : null}
      {!licenseName ? (
        <Text size="sm" variant="muted">
          ⚠ No license specified by the model author. Proceed at your own risk.
        </Text>
      ) : null}
    </View>
  )
}

function EpSelectRow({
  pickedEp,
  onPick,
  availableEps,
}: {
  pickedEp: ExecutionProvider
  onPick: (ep: ExecutionProvider) => void
  availableEps: readonly ExecutionProvider[]
}) {
  const options: SelectOption[] = useMemo(
    () => availableEps.map((ep) => ({ value: ep, label: ep })),
    [availableEps],
  )
  return (
    <View className="gap-2">
      <Text size="sm" variant="muted">
        Execution provider
      </Text>
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

function DownloadingBody({
  progressByFile,
  totalBytes,
}: {
  progressByFile: Record<string, FileProgress>
  totalBytes: number
}) {
  const entries = Object.entries(progressByFile)
  // Done files keep counting via their preserved bytesTotal; the denominator
  // is the catalog's total so the line is stable from the first render.
  const received = entries.reduce((acc, [, p]) => {
    if (p.kind === 'downloading') return acc + p.bytesReceived
    if (p.kind === 'done') return acc + (p.bytesTotal ?? 0)
    return acc
  }, 0)
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
      <Text size="sm" variant="muted">
        Total: {(received / 1_000_000).toFixed(1)} / {(totalBytes / 1_000_000).toFixed(1)} MB
      </Text>
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
    case 'persist-failed':
      return (
        <View className="gap-2">
          <Text>The model downloaded and verified, but couldn’t be saved to disk:</Text>
          <Text className="font-mono" size="sm">
            {reason.message}
          </Text>
          <Text variant="muted" size="sm">
            Check available disk space and try again.
          </Text>
        </View>
      )
  }
}

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
      return (
        <DialogFooter>
          <Button variant="secondary" onPress={props.onCancel}>
            <Text>Cancel download</Text>
          </Button>
        </DialogFooter>
      )
    case 'verifying':
    case 'done':
      return null
    case 'failed': {
      const retryable =
        state.reason.kind === 'card-fetch-failed' ||
        state.reason.kind === 'resolve-failed' ||
        state.reason.kind === 'download-failed'
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
  /** See EmbedderDownloadDialogViewProps.availableEps. Also selects the EP the
   * post-verify load is attempted under. */
  availableEps?: readonly ExecutionProvider[]
}

export function EmbedderDownloadDialog(props: EmbedderDownloadDialogProps) {
  const { open, onOpenChange, init, driver, onResolve } = props
  const [state, dispatch] = useReducer(reducer, init, initialState)
  const resolvedRef = useRef(false)
  const lastUserActionRef = useRef<'declined' | 'cancelled' | null>(null)
  // The in-flight download loop, so cancel can await its settlement before
  // deleting the directory it is writing into.
  const downloadRunRef = useRef<Promise<void> | undefined>(undefined)
  // Persisted separately from DialogState — 'downloading'/'verifying' don't
  // carry licenseText, but persistInstall (fired from the verifying effect)
  // needs the exact text the user accepted in the 'license' state.
  const licenseTextRef = useRef('')
  // The EP the post-verify load is attempted under. 'ep-picker' is unreachable
  // today, so this is the host's first available provider.
  const smokeTestEp = (props.availableEps ?? DEFAULT_AVAILABLE_EPS)[0] ?? 'cpu'

  useEffect(() => {
    if (state.kind === 'license') licenseTextRef.current = state.licenseText
  }, [state])

  useEffect(() => {
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
          licenseKind: res.licenseKind,
          licenseLink: res.licenseLink,
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

  const resolvingHfInput =
    state.kind === 'resolving' && state.init.kind === 'hf-id' ? state.init.input : null
  useEffect(() => {
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
          licenseKind: res.licenseKind,
          licenseLink: res.licenseLink,
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

  useEffect(() => {
    if (state.kind !== 'downloading') return
    if (init.kind !== 'catalog') return
    let cancelled = false
    const files = init.entry.files
    dispatch({ type: 'files-planned', files })
    const run = (async () => {
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
    downloadRunRef.current = run
    void run
    return () => {
      cancelled = true
    }
  }, [state.kind, driver, init])

  useEffect(() => {
    if (state.kind !== 'verifying') return
    if (init.kind !== 'catalog') return
    let cancelled = false
    const meta = state.meta
    const entry = init.entry
    const files = entry.files
    const expected = entry.expectedSha256
    void (async () => {
      for (const file of files) {
        if (cancelled) return
        try {
          const hash = await driver.computeSha256(file)
          if (cancelled) return
          // Fail closed: an absent expected hash means the file cannot be
          // verified, which is a verification failure, not a pass.
          const expectedHash = expected[file]
          if (!expectedHash || hash !== expectedHash) {
            void driver.deletePartial().catch(() => {})
            dispatch({ type: 'verify-failed', file })
            return
          }
          dispatch({ type: 'verify-progress', file, result: 'ok' })
        } catch {
          if (cancelled) return
          void driver.deletePartial().catch(() => {})
          dispatch({ type: 'verify-failed', file })
          return
        }
      }
      if (cancelled) return
      // Bytes that hash correctly can still fail to load (a wrong-but-valid
      // tokenizer.json, a mismatched weights sidecar, an EP the device rejects).
      // Loading once here keeps a broken model from being written as installed
      // and resurfacing much later as a bare init error at Finish.
      try {
        await driver.smokeTestEmbed({ ep: smokeTestEp })
      } catch {
        if (cancelled) return
        void driver.deletePartial().catch(() => {})
        dispatch({ type: 'smoke-test-failed', ep: smokeTestEp })
        return
      }
      if (cancelled) return
      // persistInstall writes meta.json, which is what listInstalled keys on —
      // write it before resolving to 'done' so a listed model is a real install.
      try {
        await driver.persistInstall({
          meta,
          licenseText: licenseTextRef.current,
        })
      } catch (err: unknown) {
        if (cancelled) return
        void driver.deletePartial().catch(() => {})
        const message = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'persist-failed', message })
        return
      }
      if (cancelled) return
      dispatch({ type: 'all-verified' })
    })()
    return () => {
      cancelled = true
    }
    // state.meta is intentionally omitted: it's constant for the lifetime of
    // a single 'verifying' state (only verifyByFile changes per progress
    // tick), and including it would re-run this effect — restarting the
    // verify/persist loop — on every per-file verify-progress dispatch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  useEffect(() => {
    if (resolvedRef.current) return
    if (state.kind === 'done') {
      const res = computeResolution(state)
      if (res) fireResolveOnce(res)
    } else if (state.kind === 'failed' && state.reason.kind === 'cancelled') {
      fireResolveOnce({ kind: 'cancelled' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, onResolve])

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
        // Partial files can only exist once a download has started — earlier
        // states (card-fetch, resolving, ep-picker…) never wrote to disk.
        if (
          (state.kind === 'downloading' || state.kind === 'verifying') &&
          init.kind === 'catalog'
        ) {
          // Stop the transfer, wait for it to settle, and only then delete:
          // deleting under a live writer races the final rename and, on
          // Windows, fails outright and leaves the bytes installed.
          void (async () => {
            try {
              await driver.cancelDownload()
              await downloadRunRef.current
            } finally {
              await driver.deletePartial().catch((e: unknown) => {
                logger.warn('embedder.delete_partial_failed', {
                  error: e instanceof Error ? e.message : String(e),
                })
              })
            }
          })()
        }
        dispatch({ type: 'cancel' })
      }
    }
    onOpenChange(next)
  }

  return (
    <EmbedderDownloadDialogView
      open={open}
      availableEps={props.availableEps}
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
