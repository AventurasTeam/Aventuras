import { Brain, ChevronDown, ChevronUp, Star, TriangleAlert, Wrench } from 'lucide-react-native'
import { useCallback, useMemo, useState, type Ref } from 'react'
import { Pressable, ScrollView, View } from 'react-native'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import {
  SearchableOverlayList,
  type Row,
  type Section,
  type TriggerProps,
} from '@/components/ui/searchable-overlay-list'
import { Tag } from '@/components/ui/tag'
import { Text } from '@/components/ui/text'
import { cn } from '@/lib/utils'

type ModelRef = { providerId: string; modelId: string }

type Capabilities = {
  reasoning?: boolean
  structured?: boolean
}

type ModelEntry = {
  id: string
  capabilities?: Capabilities
}

type ProviderSource = {
  id: string
  name: string
  models: ModelEntry[]
}

type ProviderModelPickerProps = {
  value: ModelRef | null
  onChange: (next: ModelRef) => void
  placeholder?: string

  providers: ProviderSource[]
  favorites: ModelRef[]
  onFavoriteToggle: (ref: ModelRef) => void

  onAddCustom: (ref: ModelRef) => void
  onRefreshProvider?: (providerId: string) => void

  // i18n-sourced map: localized keyword → capability flag. Picker matches typed
  // search against keys exactly (whole-token only — typing 'r' doesn't match
  // every reasoning model).
  capabilityKeywords?: Record<string, keyof Capabilities>

  disabled?: boolean
  disabledReason?: string
  'aria-invalid'?: boolean | 'true' | 'false'

  className?: string
}

type PickerRowData = {
  modelRef: ModelRef
  providerName: string
  capabilities?: Capabilities
  isFavorite: boolean
  source: 'favorite' | 'provider'
  // True when the row references a favorite whose modelId is no longer in the
  // provider's catalog. Renders with warning chrome; still commits on click.
  brokenFavorite?: boolean
}

const DEFAULT_PLACEHOLDER = 'Pick a model'
const DEFAULT_CAPABILITY_KEYWORDS: Record<string, keyof Capabilities> = {
  reasoning: 'reasoning',
  structured: 'structured',
}

function rowId(source: 'favorite' | 'provider', ref: ModelRef): string {
  return `${source}-${ref.providerId}-${ref.modelId}`
}

// Match query against the row text + capability-keyword whole-token contract.
// `providerName` is included so typing "anth" collapses to Anthropic-namespaced rows.
function matchesQuery(
  modelId: string,
  providerName: string,
  capabilities: Capabilities | undefined,
  query: string,
  capabilityKeywords: Record<string, keyof Capabilities>,
): boolean {
  if (!query) return true
  const trimmed = query.trim()
  if (!trimmed) return true
  const lc = trimmed.toLowerCase()
  // Capability keyword whole-token: typed value equals a known keyword exactly.
  const capabilityFlag = capabilityKeywords[lc]
  if (capabilityFlag != null) {
    return capabilities?.[capabilityFlag] === true
  }
  if (modelId.toLowerCase().includes(lc)) return true
  if (providerName.toLowerCase().includes(lc)) return true
  return false
}

// Reserved trailing column. Width is the eyeballed fit for two icons + gap-1;
// kept fixed (even when one or zero icons render) so model-name columns align
// vertically across rows regardless of capability presence — the "reserved
// column for missing capability data" contract from the picker spec.
function CapabilityIcons({ capabilities }: { capabilities?: Capabilities }) {
  return (
    <View className="w-12 flex-row items-center justify-end gap-1">
      {capabilities?.reasoning ? <Icon as={Brain} size="sm" className="text-fg-muted" /> : null}
      {capabilities?.structured ? <Icon as={Wrench} size="sm" className="text-fg-muted" /> : null}
    </View>
  )
}

type FavoriteToggleProps = {
  isFavorite: boolean
  onToggle: () => void
}

function FavoriteToggle({ isFavorite, onToggle }: FavoriteToggleProps) {
  return (
    <Pressable
      accessibilityRole="button"
      aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
      onPress={(e) => {
        // Don't activate the row when the user toggles the favorite — favorite
        // toggle and row body are two distinct gestures (per spec).
        e.stopPropagation?.()
        onToggle()
      }}
      hitSlop={6}
      className="p-1 active:opacity-70"
    >
      <Icon
        as={Star}
        size="sm"
        className={isFavorite ? 'fill-warning text-warning' : 'text-fg-muted'}
      />
    </Pressable>
  )
}

type PickerRowProps = {
  row: Row<PickerRowData>
  onFavoriteToggle: (ref: ModelRef) => void
}

function PickerRow({ row, onFavoriteToggle }: PickerRowProps) {
  const { modelRef, providerName, capabilities, isFavorite, source, brokenFavorite } = row.data
  return (
    // w-full so the inner View claims the Pressable's full width — otherwise it
    // sizes to content and the trailing-aligned caps column floats short of the
    // right edge (the flex-1 below only redistributes _remaining_ space, which
    // is zero when the parent itself is auto-width).
    <View className="w-full flex-row items-center gap-2">
      <FavoriteToggle isFavorite={isFavorite} onToggle={() => onFavoriteToggle(modelRef)} />
      {brokenFavorite ? <Icon as={TriangleAlert} size="sm" className="text-warning" /> : null}
      {/* min-w-0 lets the flex child shrink past its text intrinsic width so
          numberOfLines truncation actually kicks in inside the popover. */}
      <View className="min-w-0 flex-1 flex-col">
        <Text size="sm" className="text-fg-primary" numberOfLines={1}>
          {modelRef.modelId}
        </Text>
        {source === 'favorite' ? (
          <Text size="xs" variant="muted" numberOfLines={1}>
            {providerName}
          </Text>
        ) : null}
      </View>
      <CapabilityIcons capabilities={capabilities} />
    </View>
  )
}

type PickerTriggerProps = TriggerProps & {
  value: ModelRef | null
  placeholder: string
  selectedCapabilities?: Capabilities
  brokenState: 'provider-missing' | 'model-not-in-catalog' | null
  disabled?: boolean
  ariaInvalid?: boolean | 'true' | 'false'
}

function PickerTrigger({
  ref,
  onPress,
  'aria-haspopup': ariaHaspopup,
  'aria-expanded': ariaExpanded,
  'aria-controls': ariaControls,
  value,
  placeholder,
  selectedCapabilities,
  brokenState,
  disabled,
  ariaInvalid,
}: PickerTriggerProps) {
  return (
    <Pressable
      ref={ref as Ref<View>}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      aria-haspopup={ariaHaspopup}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-label={value ? `Selected model ${value.modelId}` : placeholder}
      className={cn(
        'h-control-md flex-row items-center justify-between gap-2 rounded-md border border-border bg-bg-base px-3',
        disabled && 'opacity-50',
        ariaInvalid && 'border-danger',
        brokenState && 'border-warning',
      )}
    >
      <View className="min-w-0 flex-1 flex-row items-center gap-2">
        {brokenState === 'provider-missing' ? (
          <Tag tone="warning">
            <Text size="xs">⚠ Provider missing</Text>
          </Tag>
        ) : brokenState === 'model-not-in-catalog' && value ? (
          <Tag tone="warning">
            <Text size="xs">⚠ {value.modelId}</Text>
          </Tag>
        ) : (
          <Text
            size="sm"
            className={cn(value ? 'text-fg-primary' : 'text-fg-muted')}
            numberOfLines={1}
          >
            {value ? value.modelId : placeholder}
          </Text>
        )}
      </View>
      <CapabilityIcons capabilities={selectedCapabilities} />
      <Icon as={ChevronDown} size="sm" className="text-fg-muted" />
    </Pressable>
  )
}

type ComposerProps = {
  providers: ProviderSource[]
  query: string
  defaultProviderId: string | undefined
  onCommit: (ref: ModelRef) => void
}

function CustomAddComposer({ providers, query, defaultProviderId, onCommit }: ComposerProps) {
  const [expanded, setExpanded] = useState(false)
  const [modelIdInput, setModelIdInput] = useState('')
  const [providerId, setProviderId] = useState<string>(defaultProviderId ?? providers[0]?.id ?? '')

  const open = useCallback(() => {
    setExpanded(true)
    // Pre-fill modelId from the current search query (the "type a miss, fall through
    // to footer" path). Subsequent reopens in the same session keep whatever the user
    // last typed in the composer.
    setModelIdInput((prev) => (prev.length > 0 ? prev : query))
    setProviderId((prev) => prev || defaultProviderId || providers[0]?.id || '')
  }, [defaultProviderId, providers, query])

  const cancel = useCallback(() => {
    setExpanded(false)
    setModelIdInput('')
  }, [])

  const trimmedModelId = modelIdInput.trim()
  const isValid = trimmedModelId.length > 0 && providerId.length > 0

  const handleAdd = useCallback(() => {
    if (!isValid) return
    onCommit({ providerId, modelId: trimmedModelId })
    setExpanded(false)
    setModelIdInput('')
  }, [isValid, onCommit, providerId, trimmedModelId])

  if (!expanded) {
    return (
      <Button variant="ghost" onPress={open}>
        <Text>+ Add custom model…</Text>
      </Button>
    )
  }
  return (
    <View className="flex-col gap-2">
      <Text size="sm" className="font-medium">
        Add custom model
      </Text>
      <Input
        value={modelIdInput}
        onChangeText={setModelIdInput}
        placeholder="model-id"
        autoCorrect={false}
        autoCapitalize="none"
        onSubmitEditing={handleAdd}
      />
      <View className="flex-row items-center gap-2">
        <Text size="xs" variant="muted">
          Under:
        </Text>
        <View className="flex-1">
          <ProviderInlinePicker providers={providers} value={providerId} onChange={setProviderId} />
        </View>
      </View>
      <View className="flex-row justify-end gap-2">
        <Button variant="ghost" size="sm" onPress={cancel}>
          <Text>Cancel</Text>
        </Button>
        <Button size="sm" disabled={!isValid} onPress={handleAdd}>
          <Text>Add</Text>
        </Button>
      </View>
    </View>
  )
}

type ProviderInlinePickerProps = {
  providers: ProviderSource[]
  value: string
  onChange: (id: string) => void
}

// Inline expandable provider picker. Looks like a Select trigger when closed;
// tapping expands a panel directly below WITHIN the composer (no Portal, no
// nested Sheet). The standard project Select would open a Sheet on phone —
// nesting that inside the picker's own Sheet violates the Sheet-over-Sheet
// ban from overlays.md and gets occluded by the keyboard regardless. This
// stays in-flow, dismisses the Input's keyboard naturally when the user taps
// the trigger (focus moves), and caps the panel at ~5 rows with internal
// scroll so a long provider list can't push Add/Cancel off-screen.
const INLINE_PANEL_MAX_HEIGHT = 180

function ProviderInlinePicker({ providers, value, onChange }: ProviderInlinePickerProps) {
  const [open, setOpen] = useState(false)
  const selected = providers.find((p) => p.id === value)
  return (
    <View className="flex-col">
      <Pressable
        accessibilityRole="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onPress={() => setOpen((v) => !v)}
        className="h-control-md flex-row items-center justify-between gap-2 rounded-md border border-border bg-bg-base px-3"
      >
        <Text size="sm" className="text-fg-primary" numberOfLines={1}>
          {selected?.name ?? 'Pick a provider'}
        </Text>
        <Icon as={open ? ChevronUp : ChevronDown} size="sm" className="text-fg-muted" />
      </Pressable>
      {open ? (
        <View
          className="mt-1 overflow-hidden rounded-md border border-border bg-bg-overlay"
          style={inlinePanelStyle}
        >
          <ScrollView keyboardShouldPersistTaps="handled">
            {providers.map((p) => {
              const isSelected = p.id === value
              return (
                <Pressable
                  key={p.id}
                  role="option"
                  aria-selected={isSelected}
                  onPress={() => {
                    onChange(p.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'w-full flex-row items-center gap-2 px-row-x-md py-row-y-md active:bg-tint-press',
                    isSelected && 'bg-bg-sunken',
                  )}
                >
                  <Text size="sm" className="w-4 text-fg-primary">
                    {isSelected ? '✓' : ''}
                  </Text>
                  <Text size="sm" className="flex-1 text-fg-primary" numberOfLines={1}>
                    {p.name}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        </View>
      ) : null}
    </View>
  )
}

const inlinePanelStyle = { maxHeight: INLINE_PANEL_MAX_HEIGHT } as const

function ProviderModelPicker({
  value,
  onChange,
  placeholder = DEFAULT_PLACEHOLDER,
  providers,
  favorites,
  onFavoriteToggle,
  onAddCustom,
  capabilityKeywords = DEFAULT_CAPABILITY_KEYWORDS,
  disabled,
  disabledReason,
  'aria-invalid': ariaInvalid,
  className,
}: ProviderModelPickerProps) {
  const [query, setQuery] = useState('')

  const favoritesByKey = useMemo(
    () => new Set(favorites.map((f) => rowId('provider', f))),
    [favorites],
  )

  // Determine if the current value is in a broken state per the trigger spec.
  const brokenState = useMemo<'provider-missing' | 'model-not-in-catalog' | null>(() => {
    if (!value) return null
    const provider = providers.find((p) => p.id === value.providerId)
    if (!provider) return 'provider-missing'
    if (!provider.models.some((m) => m.id === value.modelId)) return 'model-not-in-catalog'
    return null
  }, [value, providers])

  const selectedCapabilities = useMemo<Capabilities | undefined>(() => {
    if (!value || brokenState) return undefined
    const provider = providers.find((p) => p.id === value.providerId)
    return provider?.models.find((m) => m.id === value.modelId)?.capabilities
  }, [value, providers, brokenState])

  // The same model can surface in both the Favorites strip and its provider section;
  // listing both row ids tints both mirrors of the selection (per wireframe).
  const selectedRowIds = useMemo<string[] | undefined>(() => {
    if (!value) return undefined
    return [rowId('favorite', value), rowId('provider', value)]
  }, [value])

  // Build the substrate's sections from providers + favorites, post-filter.
  const sections = useMemo<Section<PickerRowData>[]>(() => {
    const out: Section<PickerRowData>[] = []

    // Favorites cross-provider strip — only when there's at least one favorite.
    if (favorites.length > 0) {
      const favoriteRows = favorites
        .map((favRef): Row<PickerRowData> | null => {
          const provider = providers.find((p) => p.id === favRef.providerId)
          const providerName = provider?.name ?? favRef.providerId
          const modelEntry = provider?.models.find((m) => m.id === favRef.modelId)
          const brokenFavorite = provider != null && modelEntry == null
          if (
            !matchesQuery(
              favRef.modelId,
              providerName,
              modelEntry?.capabilities,
              query,
              capabilityKeywords,
            )
          ) {
            return null
          }
          return {
            id: rowId('favorite', favRef),
            data: {
              modelRef: favRef,
              providerName,
              capabilities: modelEntry?.capabilities,
              isFavorite: true,
              source: 'favorite',
              brokenFavorite,
            },
          }
        })
        .filter((r): r is Row<PickerRowData> => r != null)
      if (favoriteRows.length > 0) {
        out.push({ id: '__favorites', header: 'Favorites', sticky: true, rows: favoriteRows })
      }
    }

    // Provider sections — order matches providers prop.
    for (const provider of providers) {
      const rows: Row<PickerRowData>[] = provider.models
        .filter((m) => matchesQuery(m.id, provider.name, m.capabilities, query, capabilityKeywords))
        .map((m) => {
          const modelRef: ModelRef = { providerId: provider.id, modelId: m.id }
          return {
            id: rowId('provider', modelRef),
            data: {
              modelRef,
              providerName: provider.name,
              capabilities: m.capabilities,
              isFavorite: favoritesByKey.has(rowId('provider', modelRef)),
              source: 'provider' as const,
            },
          }
        })
      if (rows.length > 0) {
        out.push({ id: provider.id, header: provider.name, sticky: true, rows })
      }
    }

    return out
  }, [providers, favorites, favoritesByKey, query, capabilityKeywords])

  const handleActivate = useCallback(
    (row: Row<PickerRowData>) => {
      onChange(row.data.modelRef)
    },
    [onChange],
  )

  const renderRow = useCallback(
    (row: Row<PickerRowData>) => <PickerRow row={row} onFavoriteToggle={onFavoriteToggle} />,
    [onFavoriteToggle],
  )

  const renderTrigger = useCallback(
    (p: TriggerProps) => (
      <PickerTrigger
        {...p}
        value={value}
        placeholder={placeholder}
        selectedCapabilities={selectedCapabilities}
        brokenState={brokenState}
        disabled={disabled}
        ariaInvalid={ariaInvalid}
      />
    ),
    [value, placeholder, selectedCapabilities, brokenState, disabled, ariaInvalid],
  )

  const renderFooter = useCallback(
    () => (
      <CustomAddComposer
        providers={providers}
        query={query}
        defaultProviderId={value?.providerId}
        onCommit={onAddCustom}
      />
    ),
    [providers, query, value?.providerId, onAddCustom],
  )

  const renderEmpty = useCallback(
    (q: string) => (
      <View className="items-center gap-2 px-row-x-md py-6">
        <Text size="sm" variant="muted">
          {providers.length === 0
            ? 'No providers configured. Add one in App Settings → Providers.'
            : `No models match "${q}".`}
        </Text>
      </View>
    ),
    [providers.length],
  )

  return (
    <View className={className}>
      <SearchableOverlayList<PickerRowData>
        searchPlacement="in-overlay"
        ariaLabel="Pick a model"
        searchPlaceholder="Search models…"
        sections={sections}
        selectedRowIds={selectedRowIds}
        matchTriggerWidth
        onQueryChange={setQuery}
        renderTrigger={renderTrigger}
        renderRow={renderRow}
        renderEmpty={renderEmpty}
        renderFooter={renderFooter}
        onActivate={handleActivate}
        escClearsQueryFirst
        sheetSize="tall"
        disabled={disabled}
        disabledReason={disabledReason}
        aria-invalid={ariaInvalid}
      />
    </View>
  )
}

export { ProviderModelPicker }
export type { ProviderModelPickerProps, ModelRef, Capabilities, ModelEntry, ProviderSource }
