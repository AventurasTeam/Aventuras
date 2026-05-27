import { ChevronDown, ChevronUp, Clipboard, FileText } from 'lucide-react-native'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Platform, Pressable, ScrollView, View } from 'react-native'
import type { ZodType } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Icon } from '@/components/ui/icon'
import { Spinner } from '@/components/ui/spinner'
import { Text } from '@/components/ui/text'
import { useTier } from '@/hooks/use-tier'
import { cn } from '@/lib/utils'

import {
  EmptyClipboardError,
  FilePickerCancelledError,
  useImportPipeline,
  type FlattenedIssue,
  type ImportState,
  type ReadSource,
} from './import-dialog-pipeline'

type ImportDialogProps<TPayload> = {
  open: boolean
  onOpenChange: (open: boolean) => void

  // Envelope contract per docs/data-model.md → Aventuras file format.
  format: `aventuras-${string}`
  supportedMajor: number
  payloadKey: string
  schema: ZodType<TPayload>

  // Copy
  title: string

  // Outcome — Dialog self-closes after this fires.
  onValidated: (payload: TPayload) => void

  // Test seam — forced initial pipeline state for Storybook coverage of
  // transient states (reading, error variants) that the real pipeline only
  // reaches in response to async I/O.
  _initialState?: ImportState
}

const PAYLOAD_DETAILS_MAX_HEIGHT = 200
const FILE_ACCEPT = '.avts,.json'

// Inline pointer-events gating: rn-primitives wrappers don't fully gate
// disabled clicks on web, so className-only `disabled:opacity-50` allows
// stray taps through during reading. Style-level pointerEvents stops that.
const POINTER_EVENTS_NONE = { pointerEvents: 'none' as const }

// Visually-hidden web file input — rendered always, programmatically clicked.
// We re-render outside RN's bridge (raw DOM element); RN-Web has no equivalent.
const HIDDEN_INPUT_STYLE = {
  position: 'absolute' as const,
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden' as const,
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap' as const,
  border: 0,
}

// Web feature-detect — clipboard.readText() needs HTTPS / localhost / Electron.
// On native, expo-clipboard is always present. Memo-ed once at module level so
// the result is stable across re-renders (the API doesn't appear at runtime).
const CLIPBOARD_AVAILABLE =
  Platform.OS !== 'web' ||
  (typeof navigator !== 'undefined' &&
    navigator.clipboard != null &&
    typeof navigator.clipboard.readText === 'function')

async function readClipboardWeb(): Promise<string> {
  const text = await navigator.clipboard.readText()
  if (text === '') throw new EmptyClipboardError()
  return text
}

async function readClipboardNative(): Promise<string> {
  const Clipboard = await import('expo-clipboard')
  const text = await Clipboard.getStringAsync()
  if (text === '') throw new EmptyClipboardError()
  return text
}

async function pickAndReadFileNative(): Promise<string> {
  const DocumentPicker = await import('expo-document-picker')
  const result = await DocumentPicker.getDocumentAsync({
    // Android doesn't reliably MIME-type `.avts`; the dual accept-list +
    // extension fallback covers the gap (per spec).
    type: ['application/json', 'application/octet-stream'],
    multiple: false,
    copyToCacheDirectory: true,
  })
  if (result.canceled) throw new FilePickerCancelledError()
  const asset = result.assets[0]
  if (!asset) throw new FilePickerCancelledError()
  const FileSystem = await import('expo-file-system/legacy')
  return FileSystem.readAsStringAsync(asset.uri)
}

export function ImportDialog<TPayload>({
  open,
  onOpenChange,
  format,
  supportedMajor,
  payloadKey,
  schema,
  title,
  onValidated,
  _initialState,
}: ImportDialogProps<TPayload>) {
  const tier = useTier()
  const isPhone = tier === 'phone'

  const onSuccess = useCallback(
    (payload: TPayload) => {
      onValidated(payload)
      onOpenChange(false)
    },
    [onValidated, onOpenChange],
  )

  const pipeline = useImportPipeline<TPayload>({
    format,
    supportedMajor,
    payloadKey,
    schema,
    onSuccess,
    _initialState,
  })

  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const hiddenInputRef = useRef<HTMLInputElement | null>(null)

  // Reset pipeline + details disclosure each time the dialog opens — picking up
  // mid-failure from a prior open would surface stale errors.
  useEffect(() => {
    if (open) {
      pipeline.reset()
      setDetailsExpanded(false)
    }
    // pipeline.reset is stable (useCallback []); avoid re-firing on hook recreation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleFilePress = useCallback(() => {
    if (Platform.OS === 'web') {
      const el = hiddenInputRef.current
      if (!el) return
      // Reset so the same file can be re-picked after an error.
      el.value = ''
      el.click()
      return
    }
    void pipeline.runPipeline('file', pickAndReadFileNative)
  }, [pipeline])

  const handleClipboardPress = useCallback(() => {
    if (!CLIPBOARD_AVAILABLE) return
    const reader = Platform.OS === 'web' ? readClipboardWeb : readClipboardNative
    void pipeline.runPipeline('clipboard', reader)
  }, [pipeline])

  const handleWebFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      void pipeline.runPipeline('file', () => file.text())
    },
    [pipeline],
  )

  const isReading = pipeline.state.kind === 'reading'
  const readingSource: ReadSource | null =
    pipeline.state.kind === 'reading' ? pipeline.state.source : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <ErrorRegion
          state={pipeline.state}
          expanded={detailsExpanded}
          onToggleExpand={() => setDetailsExpanded((v) => !v)}
          isPhone={isPhone}
        />

        <View className="flex-col gap-2">
          <SourceButton
            label="Choose .avts file…"
            icon={FileText}
            disabled={isReading}
            loading={readingSource === 'file'}
            onPress={handleFilePress}
          />
          <SourceButton
            label="Import from clipboard"
            icon={Clipboard}
            disabled={isReading || !CLIPBOARD_AVAILABLE}
            disabledReason={CLIPBOARD_AVAILABLE ? undefined : 'Clipboard access not available.'}
            loading={readingSource === 'clipboard'}
            onPress={handleClipboardPress}
          />
        </View>

        <Text size="xs" variant="muted">
          .avts and .json files supported.
        </Text>

        <DialogFooter>
          <Button variant="ghost" onPress={() => onOpenChange(false)}>
            <Text>Cancel</Text>
          </Button>
        </DialogFooter>

        {Platform.OS === 'web' ? (
          // Visually-hidden file input. Rendered inside DialogContent so it
          // shares the dialog's React subtree (focus management, unmount on
          // close). RN-Web has no equivalent; raw HTML element is required.
          <input
            ref={hiddenInputRef}
            type="file"
            accept={FILE_ACCEPT}
            aria-hidden="true"
            tabIndex={-1}
            style={HIDDEN_INPUT_STYLE}
            onChange={handleWebFileChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

type ErrorRegionProps = {
  state: ImportState
  expanded: boolean
  onToggleExpand: () => void
  isPhone: boolean
}

function ErrorRegion({ state, expanded, onToggleExpand, isPhone }: ErrorRegionProps) {
  if (state.kind === 'meta-error') {
    return <MetaErrorBanner copy={state.copy} />
  }
  if (state.kind === 'payload-error') {
    return (
      <PayloadErrorBanner
        issues={state.issues}
        expanded={expanded}
        onToggleExpand={onToggleExpand}
        isPhone={isPhone}
      />
    )
  }
  return null
}

function MetaErrorBanner({ copy }: { copy: string }) {
  return (
    <View
      role="alert"
      accessibilityLiveRegion="assertive"
      className="relative overflow-hidden rounded-md px-3 py-2"
    >
      <View
        className="absolute inset-0 bg-warning opacity-[.12]"
        aria-hidden
        style={POINTER_EVENTS_NONE}
      />
      <Text size="sm" className="text-warning">
        {copy}
      </Text>
    </View>
  )
}

type PayloadErrorBannerProps = {
  issues: readonly FlattenedIssue[]
  expanded: boolean
  onToggleExpand: () => void
  isPhone: boolean
}

function PayloadErrorBanner({
  issues,
  expanded,
  onToggleExpand,
  isPhone,
}: PayloadErrorBannerProps) {
  const countCopy = issues.length === 1 ? '1 issue.' : `${issues.length} issues.`
  return (
    <View
      role="alert"
      accessibilityLiveRegion="assertive"
      className="relative overflow-hidden rounded-md px-3 py-2"
    >
      <View
        className="absolute inset-0 bg-warning opacity-[.12]"
        aria-hidden
        style={POINTER_EVENTS_NONE}
      />
      <View className="flex-row items-center justify-between gap-2">
        <Text size="sm" className="text-warning">
          ⚠ Invalid format — {countCopy}
        </Text>
        <Pressable
          accessibilityRole="button"
          aria-expanded={expanded}
          accessibilityState={{ expanded }}
          onPress={onToggleExpand}
          hitSlop={8}
          className={cn(
            'flex-row items-center gap-1 rounded px-1 py-0.5',
            Platform.select({
              web: 'cursor-pointer outline-none transition-colors hover:bg-tint-hover focus-visible:ring-2 focus-visible:ring-focus-ring',
            }),
          )}
        >
          <Text size="xs" className="text-warning">
            {expanded ? 'Hide details' : 'Show details'}
          </Text>
          <Icon as={expanded ? ChevronUp : ChevronDown} size="sm" className="text-warning" />
        </Pressable>
      </View>
      {expanded ? <PayloadIssueList issues={issues} isPhone={isPhone} /> : null}
    </View>
  )
}

function PayloadIssueList({
  issues,
  isPhone,
}: {
  issues: readonly FlattenedIssue[]
  isPhone: boolean
}) {
  const list = (
    <View className="mt-2 flex-col gap-1">
      {issues.map((issue, idx) => (
        <Text key={`${issue.path}-${idx}`} size="xs" className="text-warning">
          • {issue.path} — {issue.message}
        </Text>
      ))}
    </View>
  )
  if (isPhone) {
    // Phone: expand inline; the whole Dialog body becomes scrollable (the
    // Dialog primitive's content area is the scroll surface, no nested scroll).
    return list
  }
  // Desktop / tablet: bounded internal scroll keeps the dialog body compact.
  return <ScrollView style={{ maxHeight: PAYLOAD_DETAILS_MAX_HEIGHT }}>{list}</ScrollView>
}

type SourceButtonProps = {
  label: string
  icon: typeof FileText
  disabled: boolean
  loading?: boolean
  disabledReason?: string
  onPress: () => void
}

function SourceButton({
  label,
  icon,
  disabled,
  loading,
  disabledReason,
  onPress,
}: SourceButtonProps) {
  const button = (
    <Button
      variant="secondary"
      onPress={onPress}
      disabled={disabled}
      aria-busy={loading}
      accessibilityState={loading ? { busy: true } : undefined}
      className={cn(disabled && 'opacity-50')}
      style={disabled ? POINTER_EVENTS_NONE : undefined}
    >
      {loading ? <Spinner size="sm" /> : <Icon as={icon} size="sm" />}
      <Text>{label}</Text>
    </Button>
  )
  // RN-Web's Pressable drops `title`; wrap on web for the disabled tooltip.
  if (disabled && disabledReason && Platform.OS === 'web') {
    return <div title={disabledReason}>{button}</div>
  }
  return button
}

export type { ImportDialogProps }
