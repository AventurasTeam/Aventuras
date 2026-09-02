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
import { downloadFailureCode } from '@/lib/embedder'
import { t } from '@/lib/i18n'
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

// Every outbound link here originates in remote model-card JSON, so the scheme
// is checked before handing it to the OS — on Android an unvalidated scheme
// reaches other installed apps through ACTION_VIEW.
function openExternalUrl(url: string): void {
  if (!/^https?:\/\//i.test(url)) {
    logger.warn('embedder.blocked_external_url', { url })
    return
  }
  void Linking.openURL(url).catch((e: unknown) => {
    logger.error('embedder.open_external_failed', {
      url,
      error: e instanceof Error ? e.message : String(e),
    })
  })
}

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
      <DialogContent
        className="sm:max-w-[560px]"
        portalHost={portalHost}
        hideCloseButton
        scrollable={false}
      >
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
    <DialogHeader hasCloseButton={false}>
      <DialogTitle>{titleFor(state)}</DialogTitle>
    </DialogHeader>
  )
}

function titleFor(state: DialogState): string {
  switch (state.kind) {
    case 'hf-input':
      return t('embedder:title.hfInput')
    case 'resolving':
      return t('embedder:title.resolving')
    case 'card-fetch':
    case 'license':
      return t('embedder:title.install', { model: state.meta.displayName })
    case 'ep-picker':
      return t('embedder:title.epPicker', { model: state.meta.displayName })
    case 'import-confirm':
      return t('embedder:title.import')
    case 'downloading':
      return t('embedder:title.downloading', { model: state.meta.displayName })
    case 'verifying':
      return t('embedder:title.verifying', { model: state.meta.displayName })
    case 'done':
      return t('embedder:title.installed', { model: state.meta.displayName })
    case 'failed':
      return failedTitle(state.reason)
  }
}

function failedTitle(reason: FailReason): string {
  switch (reason.kind) {
    case 'cancelled':
      return t('embedder:failedTitle.cancelled')
    case 'card-fetch-failed':
      return t('embedder:failedTitle.cardFetchFailed')
    case 'resolve-failed':
      return t('embedder:failedTitle.resolveFailed')
    case 'download-failed':
      return t('embedder:failedTitle.downloadFailed')
    case 'validation-failed':
      return t('embedder:failedTitle.validationFailed')
    case 'hash-mismatch':
      return t('embedder:failedTitle.hashMismatch')
    case 'verify-error':
      return t('embedder:failedTitle.verifyError')
    case 'smoke-test-failed':
      return t('embedder:failedTitle.smokeTestFailed')
    case 'persist-failed':
      return t('embedder:failedTitle.persistFailed')
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
        {t('embedder:hfInput.hint')}
      </Text>
      <Input
        placeholder={t('embedder:hfInput.placeholder')}
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
      <Text variant="muted">{t('embedder:resolving')}</Text>
    </View>
  )
}

function CardFetchBody({ source }: { source: string }) {
  return (
    <View className="items-center gap-3 py-6">
      <Spinner />
      <Text variant="muted">{t('embedder:cardFetch.loading', { source })}</Text>
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
  const openLink = useCallback((url: string) => openExternalUrl(url), [])
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
          <Text variant="muted">{t('embedder:license.sourceLabel')}</Text>
          {meta.source}
        </Text>
        <Text size="sm">
          <Text variant="muted">{t('embedder:license.revisionLabel')}</Text>
          {meta.revision}
        </Text>
        <Text size="sm">
          <Text variant="muted">{t('embedder:license.sizeLabel')}</Text>
          {t('embedder:license.sizeValue', { size: sizeMb, count: meta.fileCount })}
        </Text>
      </View>
      <Text size="sm" className="font-semibold">
        {isModelCard
          ? t('embedder:license.modelCardHeading', {
              name: licenseName || t('embedder:license.unspecified'),
            })
          : t('embedder:license.licenseHeading', {
              name: licenseName || t('embedder:license.noneSpecified'),
            })}
      </Text>
      {isModelCard ? (
        <ModelCardRegion markdown={licenseText} sourceUrl={meta.source} />
      ) : (
        <ScrollView
          accessibilityLabel={t('embedder:license.a11yRegion')}
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
          {t('embedder:license.modelCardNotice')}
          {licenseLink ? (
            <>
              {' '}
              <Text
                size="sm"
                className="text-accent underline"
                accessibilityRole="link"
                onPress={() => openExternalUrl(licenseLink)}
              >
                {t('embedder:license.viewTerms')}
              </Text>
            </>
          ) : null}
        </Text>
      ) : null}
      {!licenseName ? (
        <Text size="sm" variant="muted">
          {t('embedder:license.noLicenseWarning')}
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
        {t('embedder:ep.label')}
      </Text>
      <Select
        options={options}
        value={pickedEp}
        onValueChange={onPick}
        mode="radio"
        label={t('embedder:ep.label')}
      />
      <Text size="sm" variant="muted">
        {t('embedder:ep.warning')}
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
        {t('embedder:ep.pickHint')}
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
        {t('embedder:import.notice')}
      </Text>
      <View className="gap-1">
        <Text size="sm">
          <Text variant="muted">{t('embedder:import.modelIdLabel')}</Text>
          {bundle.modelId}
        </Text>
        <Text size="sm" variant="muted">
          {t('embedder:import.filesLabel')}
        </Text>
        {bundle.files.map((f) => (
          <Text key={f.name} size="sm">
            {t('embedder:import.fileRow', {
              name: f.name,
              size: (f.sizeBytes / 1_000_000).toFixed(1),
            })}
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
              {progress.kind === 'waiting' && t('embedder:downloading.waiting')}
              {progress.kind === 'downloading' && formatFilePercent(progress)}
              {progress.kind === 'done' && t('embedder:downloading.done')}
            </Text>
          </View>
          <View className="h-1 rounded-full bg-bg-sunken">
            <View
              className="h-1 rounded-full bg-accent"
              style={{ width: progressBarWidth(progress) }}
            />
          </View>
        </View>
      ))}
      <Text size="sm" variant="muted">
        {t('embedder:downloading.total', {
          received: (received / 1_000_000).toFixed(1),
          total: (totalBytes / 1_000_000).toFixed(1),
        })}
      </Text>
    </View>
  )
}

// A server that omits content-length reports the total as -1 (desktop) or 0
// (native): both make the naive percentage Infinity or NaN, which renders as a
// broken bar and an "Infinity%" label.
function knownTotal(progress: { bytesTotal?: number }): number | null {
  const total = progress.bytesTotal
  return total !== undefined && Number.isFinite(total) && total > 0 ? total : null
}

function formatFilePercent(progress: { bytesReceived: number; bytesTotal: number }): string {
  const total = knownTotal(progress)
  if (total === null)
    return t('embedder:downloading.unknownSize', {
      received: (progress.bytesReceived / 1_000_000).toFixed(1),
    })
  const pct = Math.min(100, Math.round((progress.bytesReceived / total) * 100))
  return `${pct}%`
}

function progressBarWidth(progress: FileProgress): `${number}%` {
  if (progress.kind === 'done') return '100%'
  if (progress.kind !== 'downloading') return '0%'
  const total = knownTotal(progress)
  // Indeterminate: a thin sliver rather than a bar that reads as complete.
  if (total === null) return '10%'
  return `${Math.min(100, (progress.bytesReceived / total) * 100)}%`
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
            {status === 'ok' && t('embedder:verifying.ok')}
            {status === 'fail' && t('embedder:verifying.fail')}
            {status === 'pending' && t('embedder:verifying.pending')}
          </Text>
        </View>
      ))}
    </View>
  )
}

function DoneBody() {
  return (
    <View className="items-center gap-2 py-4">
      <Text>{t('embedder:done')}</Text>
    </View>
  )
}

// Untranslatable payload (an OS errno, a third-party message) is labelled as
// technical detail rather than presented as the explanation — the explanation
// itself comes from the failure's code.
function TechnicalDetail({ detail }: { detail: string }) {
  return (
    <View className="gap-1">
      <Text size="xs" variant="muted">
        {t('embedder:failure.technicalDetail')}
      </Text>
      <Text className="font-mono" size="sm">
        {detail}
      </Text>
    </View>
  )
}

function FailedBody({ reason }: { reason: FailReason }) {
  switch (reason.kind) {
    case 'cancelled':
      return <Text variant="muted">{t('embedder:failure.cancelled')}</Text>
    case 'card-fetch-failed':
      return (
        <View className="gap-2">
          <Text>{t('embedder:failure.cardFetchLead')}</Text>
          <TechnicalDetail detail={reason.message} />
          <Text variant="muted" size="sm">
            {t('embedder:failure.cardFetchHint')}
          </Text>
        </View>
      )
    case 'resolve-failed':
      return (
        <View className="gap-2">
          <Text>{t('embedder:failure.resolveLead')}</Text>
          <TechnicalDetail detail={reason.message} />
        </View>
      )
    case 'download-failed':
      return (
        <View className="gap-2">
          <Text>{t('embedder:failure.downloadLead', { file: reason.failingFile })}</Text>
          <Text variant="muted" size="sm">
            {t(`embedder:failure.downloadHint.${reason.code}` as const)}
          </Text>
          <TechnicalDetail detail={reason.detail} />
        </View>
      )
    case 'validation-failed':
      return (
        <View className="gap-2">
          <Text>{t('embedder:failure.validationLead')}</Text>
          <Text variant="muted" size="sm">
            {t('embedder:failure.validationMissing', { files: reason.missingFiles.join(', ') })}
          </Text>
          <Text variant="muted" size="sm">
            {t('embedder:failure.validationHint')}
          </Text>
        </View>
      )
    case 'hash-mismatch':
      return (
        <View className="gap-2">
          <Text>{t('embedder:failure.hashMismatchLead', { file: reason.failingFile })}</Text>
          <Text variant="muted" size="sm">
            {t('embedder:failure.hashMismatchHint')}
          </Text>
        </View>
      )
    case 'verify-error':
      return (
        <View className="gap-2">
          <Text>{t('embedder:failure.verifyErrorLead', { file: reason.failingFile })}</Text>
          <Text variant="muted" size="sm">
            {t('embedder:failure.verifyErrorHint')}
          </Text>
          <TechnicalDetail detail={reason.message} />
        </View>
      )
    case 'smoke-test-failed':
      return (
        <View className="gap-2">
          <Text>{t('embedder:failure.smokeTestLead')}</Text>
          <Text variant="muted" size="sm">
            {t('embedder:failure.smokeTestHint')}
          </Text>
        </View>
      )
    case 'persist-failed':
      return (
        <View className="gap-2">
          <Text>{t('embedder:failure.persistLead')}</Text>
          <Text variant="muted" size="sm">
            {t('embedder:failure.persistHint')}
          </Text>
          <TechnicalDetail detail={reason.message} />
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
            <Text>{t('embedder:action.cancel')}</Text>
          </Button>
          <Button variant="primary" onPress={() => props.onSubmitHfInput(props.hfInputValue)}>
            <Text>{t('embedder:action.resolve')}</Text>
          </Button>
        </DialogFooter>
      )
    case 'resolving':
    case 'card-fetch':
      return (
        <DialogFooter>
          <Button variant="secondary" onPress={props.onCancel}>
            <Text>{t('embedder:action.cancel')}</Text>
          </Button>
        </DialogFooter>
      )
    case 'license':
      return (
        <DialogFooter>
          <Button variant="secondary" onPress={props.onDeclineLicense}>
            <Text>{t('embedder:action.decline')}</Text>
          </Button>
          <Button variant="primary" onPress={props.onAcceptLicense}>
            <Text>{t('embedder:action.accept')}</Text>
          </Button>
        </DialogFooter>
      )
    case 'ep-picker':
      return (
        <DialogFooter>
          <Button variant="secondary" onPress={props.onCancel}>
            <Text>{t('embedder:action.cancel')}</Text>
          </Button>
          <Button variant="primary" onPress={props.onContinueEp}>
            <Text>{t('embedder:action.continue')}</Text>
          </Button>
        </DialogFooter>
      )
    case 'import-confirm':
      return (
        <DialogFooter>
          <Button variant="secondary" onPress={props.onCancel}>
            <Text>{t('embedder:action.cancel')}</Text>
          </Button>
          <Button variant="primary" onPress={props.onConfirmImport}>
            <Text>{t('embedder:action.import')}</Text>
          </Button>
        </DialogFooter>
      )
    case 'downloading':
      return (
        <DialogFooter>
          <Button variant="secondary" onPress={props.onCancel}>
            <Text>{t('embedder:action.cancelDownload')}</Text>
          </Button>
        </DialogFooter>
      )
    case 'verifying':
      // Hashing a 300MB file is long enough that an unexplained dead dialog
      // reads as a hang; Escape/back already work, this makes it discoverable.
      return (
        <DialogFooter>
          <Button variant="secondary" onPress={props.onCancel}>
            <Text>{t('embedder:action.cancel')}</Text>
          </Button>
        </DialogFooter>
      )
    case 'done':
      return null
    case 'failed': {
      const retryable =
        state.reason.kind === 'card-fetch-failed' ||
        state.reason.kind === 'resolve-failed' ||
        state.reason.kind === 'download-failed' ||
        state.reason.kind === 'verify-error'
      if (retryable) {
        return (
          <DialogFooter>
            <Button variant="secondary" onPress={props.onCancel}>
              <Text>{t('embedder:action.cancel')}</Text>
            </Button>
            <Button variant="primary" onPress={props.onRetry}>
              <Text>{t('embedder:action.retry')}</Text>
            </Button>
          </DialogFooter>
        )
      }
      return (
        <DialogFooter>
          <Button variant="primary" onPress={props.onClose}>
            <Text>{t('embedder:action.close')}</Text>
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
        const detail = err instanceof Error ? err.message : String(err)
        const code = downloadFailureCode(err)
        logger.error('embedder.download_failed', { file: currentFile, code, error: detail })
        // Keeping the bytes is right for a dropped connection (a retry resumes),
        // but exactly wrong when the disk is full — reclaim the space instead.
        if (code === 'disk') {
          await driver.deletePartial().catch((e: unknown) => {
            logger.warn('embedder.delete_partial_failed', {
              error: e instanceof Error ? e.message : String(e),
            })
          })
        }
        dispatch({ type: 'download-failed', file: currentFile, code, detail })
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
        } catch (err: unknown) {
          if (cancelled) return
          // Not a mismatch: the digest was never computed. Keep the bytes so a
          // retry can resume rather than re-pull the whole manifest.
          const message = err instanceof Error ? err.message : String(err)
          logger.error('embedder.verify_failed', { file, error: message })
          dispatch({ type: 'verify-error', file, message })
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
        // Resolve here, not from the effect: the host unmounts this component
        // on the onOpenChange below, so the effect never gets to run.
        fireResolveOnce({ kind: 'declined' })
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
        fireResolveOnce({ kind: 'cancelled' })
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
