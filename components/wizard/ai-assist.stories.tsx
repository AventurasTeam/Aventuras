import type { Meta, StoryObj } from '@storybook/react-native-web-vite'
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'

import { Text } from '@/components/ui/text'
import type { GenerateStructuredResult } from '@/lib/ai'

import { AiAssist } from './ai-assist'
import { composeKey, nameKey, type AssistListItem, type DedupeKey } from './ai-assist-logic'

// AiAssist drives the overlay state machine around two injected seams: `run`
// (the bound assist call) and `resolveModelId` (configured model id, or null).
// The stories feed fakes so nothing hits a real provider or the settings store.

const MODEL_ID = 'gpt-4o-mini'

function okRun<T>(value: T) {
  return async (_guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> => ({
    status: 'ok',
    value,
  })
}

function failRun<T>(detail: string) {
  return async (_guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> => ({
    status: 'failed',
    detail,
  })
}

// Fails once (drives the Failure state), then succeeds — exercises "Try
// again" re-invoking the same call rather than just re-showing guidance.
function flakyThenOkRun<T>(value: T, detail: string) {
  let calls = 0
  return async (_guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> => {
    calls += 1
    if (calls === 1) return { status: 'failed', detail }
    return { status: 'ok', value }
  }
}

// Never settles — holds the component in 'loading' so a play function can
// assert the spinner + model name without racing a real resolution.
function neverResolvingRun<T>() {
  return (_guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> =>
    new Promise(() => {})
}

// First call resolves, second call hangs (for a play function to cancel),
// every call after that resolves with `after` — models a `Generate more`
// that gets cancelled and is then followed by a fresh Generate.
function okHangThenOkRun<T>(first: T, after: T) {
  let call = 0
  return (_guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> => {
    call += 1
    if (call === 1) return Promise.resolve({ status: 'ok', value: first })
    if (call === 2) return new Promise(() => {})
    return Promise.resolve({ status: 'ok', value: after })
  }
}

// Never settles — holds a refine in 'loading' so a play function can cancel
// it mid-flight and assert the ORIGINAL preview survives, not an empty one.
function neverResolvingRefine<T>() {
  return (
    _current: T,
    _instruction: string,
    _signal: AbortSignal,
  ): Promise<GenerateStructuredResult<T>> => new Promise(() => {})
}

// Fails once, then succeeds — and records every (current, instruction) pair
// it was called with, so a play function can assert Try-again replayed the
// SAME refine rather than falling back to a fresh generate.
function flakyThenOkRefine<T>(
  value: T,
  detail: string,
  calls: { current: T; instruction: string }[],
) {
  let attempts = 0
  return async (
    current: T,
    instruction: string,
    _signal: AbortSignal,
  ): Promise<GenerateStructuredResult<T>> => {
    calls.push({ current, instruction })
    attempts += 1
    if (attempts === 1) return { status: 'failed', detail }
    return { status: 'ok', value }
  }
}

// Returns the next result per call — Generate / Generate more / Try again /
// Regenerate each count as one call — repeating the last entry past the end.
// Drives the list-result multi-page and failure-then-retry stories.
function sequentialRun<T>(results: GenerateStructuredResult<T>[]) {
  let call = 0
  return async (_guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> => {
    const result = results[Math.min(call, results.length - 1)]
    call += 1
    return result
  }
}

// Records every guidance string `run` was called with — proves Regenerate
// replays the guidance the original generate used, not an empty string.
function guidanceCapturingRun<T>(value: T, calls: string[]) {
  return async (guidance: string, _signal: AbortSignal): Promise<GenerateStructuredResult<T>> => {
    calls.push(guidance)
    return { status: 'ok', value }
  }
}

// Records the exclusion list `run` was called with on each page — the only
// thing that proves `Generate more` asks the model for something new instead
// of re-rolling the prompt that produced page one.
function excludeCapturingRun<T>(pages: T[], calls: (readonly string[])[]) {
  let call = 0
  return async (
    _guidance: string,
    _signal: AbortSignal,
    exclude: readonly string[],
  ): Promise<GenerateStructuredResult<T>> => {
    calls.push(exclude)
    const value = pages[Math.min(call, pages.length - 1)]
    call += 1
    return { status: 'ok', value }
  }
}

type DescriptionValue = { description: string }
type TitlesValue = { titles: string[] }

// Appends the instruction to the CURRENT description rather than replacing
// it, so a play function can observe refine's cumulative stacking.
async function appendInstructionRefine(
  current: DescriptionValue,
  instruction: string,
  _signal: AbortSignal,
): Promise<GenerateStructuredResult<DescriptionValue>> {
  return { status: 'ok', value: { description: `${current.description} / ${instruction}` } }
}

type ProseDemoProps = {
  resolveModelId: () => string | null
  run: (
    guidance: string,
    signal: AbortSignal,
  ) => Promise<GenerateStructuredResult<DescriptionValue>>
  refine?: (
    current: DescriptionValue,
    instruction: string,
    signal: AbortSignal,
  ) => Promise<GenerateStructuredResult<DescriptionValue>>
  onSetup: () => void
  onUse: (value: DescriptionValue) => void
  /** Pre-existing field content — drives the seeded-preview entry point. */
  committed?: DescriptionValue
}

// Shared demo for every prose-result scenario (guidance / loading / result /
// failure / not-configured) — result presentation only diverges at the
// 'result' state, so one wrapper covers the rest of the state machine too.
function ProseDemo({ resolveModelId, run, refine, onSetup, onUse, committed }: ProseDemoProps) {
  const [lastUsed, setLastUsed] = useState('(none)')
  return (
    <View className="w-96 gap-3 rounded-md bg-bg-base p-6">
      <Text size="sm" variant="muted">
        Committed: {lastUsed}
      </Text>
      <AiAssist
        ariaLabel="Suggest description"
        guidancePlaceholder='e.g. "a tense heist thriller"'
        run={run}
        refine={refine}
        committed={committed}
        resolveModelId={resolveModelId}
        result="prose"
        getProse={(v) => v.description}
        onUse={(v) => {
          setLastUsed(v.description)
          onUse(v)
        }}
        onSetup={onSetup}
      />
    </View>
  )
}

type ChipsDemoProps = {
  resolveModelId: () => string | null
  run: (guidance: string, signal: AbortSignal) => Promise<GenerateStructuredResult<TitlesValue>>
  onSetup: () => void
  onPickChip: (chip: string, value: TitlesValue) => void
}

function ChipsDemo({ resolveModelId, run, onSetup, onPickChip }: ChipsDemoProps) {
  const [committed, setCommitted] = useState('(none)')
  return (
    <View className="w-96 gap-3 rounded-md bg-bg-base p-6">
      <Text size="sm" variant="muted">
        Committed: {committed}
      </Text>
      <AiAssist
        ariaLabel="Suggest title"
        guidancePlaceholder='e.g. "punchy, one word"'
        run={run}
        resolveModelId={resolveModelId}
        result="chips"
        getChips={(v) => v.titles}
        onPickChip={(chip, value) => {
          setCommitted(chip)
          onPickChip(chip, value)
        }}
        onSetup={onSetup}
      />
    </View>
  )
}

// `payload` carries the name too: onImport hands back payloads alone, so a
// consumer that needs a label has to have put one there.
type ListPayload = { name: string; category: string; tags?: string[] }
type ListItemValue = { items: AssistListItem<ListPayload>[] }

type ListDemoProps = {
  resolveModelId: () => string | null
  run: (
    guidance: string,
    signal: AbortSignal,
    exclude: readonly string[],
  ) => Promise<GenerateStructuredResult<ListItemValue>>
  existingKeys?: DedupeKey[]
  excludeLabel?: (item: AssistListItem<ListPayload>) => string
  onSetup: () => void
  onImport: (payloads: ListPayload[]) => void
}

function ListDemo({
  resolveModelId,
  run,
  existingKeys = [],
  excludeLabel,
  onSetup,
  onImport,
}: ListDemoProps) {
  const [imported, setImported] = useState<string[]>([])
  return (
    <View className="w-96 gap-3 rounded-md bg-bg-base p-6">
      <Text size="sm" variant="muted">
        Imported: {imported.length === 0 ? '(none)' : imported.join(', ')}
      </Text>
      <AiAssist
        ariaLabel="Suggest lore"
        guidancePlaceholder='e.g. "ancient ruins"'
        run={run}
        resolveModelId={resolveModelId}
        result="list"
        getItems={(v) => v.items}
        existingKeys={existingKeys}
        excludeLabel={excludeLabel}
        onImport={(payloads) => {
          setImported(payloads.map((p) => p.name))
          onImport(payloads)
        }}
        onSetup={onSetup}
      />
    </View>
  )
}

type ListDemoWithLiveExistingProps = {
  resolveModelId: () => string | null
  run: (guidance: string, signal: AbortSignal) => Promise<GenerateStructuredResult<ListItemValue>>
  // Exposes the setter directly rather than via an on-screen control: a
  // button would sit outside DialogContent's DOM, and clicking it would
  // register as an outside-interaction and dismiss the overlay through
  // handleOpenChange before the play function could observe anything.
  onReady: (setExistingKeys: (keys: DedupeKey[]) => void) => void
}

// `existingKeys` toggles live (unlike ListDemo's fixed prop) so a play
// function can check a row, THEN mark it existing — reaching the
// checked+disabled combination a static existingKeys prop can't produce.
function ListDemoWithLiveExisting({ resolveModelId, run, onReady }: ListDemoWithLiveExistingProps) {
  const [existingKeys, setExistingKeys] = useState<DedupeKey[]>([])
  useEffect(() => {
    onReady(setExistingKeys)
  }, [onReady])
  return (
    <View className="w-96 gap-3 rounded-md bg-bg-base p-6">
      <AiAssist
        ariaLabel="Suggest lore"
        run={run}
        resolveModelId={resolveModelId}
        result="list"
        getItems={(v) => v.items}
        existingKeys={existingKeys}
        onImport={fn()}
        onSetup={fn()}
      />
    </View>
  )
}

const meta: Meta<typeof AiAssist> = {
  title: 'Compounds/Wizard/AiAssist',
  component: AiAssist,
  parameters: { layout: 'centered' },
}

export default meta
type Story = StoryObj<typeof AiAssist>

export const Guidance: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={neverResolvingRun<DescriptionValue>()}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    expect(await screen.findByText('Optional guidance')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('e.g. "a tense heist thriller"')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument()
  },
}

export const Loading: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={neverResolvingRun<DescriptionValue>()}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    const guidance = await screen.findByRole('textbox', { name: 'Optional guidance' })
    await userEvent.type(guidance, 'a tense heist')
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Generating with gpt-4o-mini…')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeInTheDocument()

    // Loading keeps the guidance form rather than swapping the body for a
    // spinner: the sheet holds one detent across both states, so replacing the
    // content would leave it half empty. The field stays readable, disabled.
    const duringLoad = screen.getByRole('textbox', { name: 'Optional guidance' })
    expect(duringLoad).toHaveValue('a tense heist')
    // `editable={false}` reaches the DOM as readOnly, not disabled — RN-Web has
    // no disabled concept for TextInput, and Input's own isDisabled only drives
    // the dimming classes.
    expect(duringLoad).toHaveAttribute('readonly')
    await userEvent.click(duringLoad)
    expect(duringLoad).toHaveAttribute('virtualkeyboardpolicy', 'manual')
    // Generate is gone, so the only way forward is Cancel — no double-submit.
    expect(screen.queryByRole('button', { name: 'Generate' })).not.toBeInTheDocument()

    // Cancel aborts the in-flight call and returns to guidance rather than
    // closing outright — the user can tweak guidance and retry.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('button', { name: 'Generate' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Optional guidance' })).not.toHaveAttribute(
      'readonly',
    )
  },
}

const proseUseThisMock = fn()
export const ProseResult_UseThis: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({
        description: 'A grizzled captain smuggles refugees past a naval blockade.',
      })}
      onSetup={fn()}
      onUse={proseUseThisMock}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText(/grizzled captain/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))
    await waitFor(() =>
      expect(proseUseThisMock).toHaveBeenCalledWith({
        description: 'A grizzled captain smuggles refugees past a naval blockade.',
      }),
    )
    expect(
      await screen.findByText(
        'Committed: A grizzled captain smuggles refugees past a naval blockade.',
      ),
    ).toBeInTheDocument()
    // The overlay closed — its chrome is gone from the DOM.
    expect(screen.queryByText('Optional guidance')).not.toBeInTheDocument()
  },
}

const proseDiscardMock = fn()
export const ProseResult_Discard: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({ description: 'Discarded suggestion text.' })}
      onSetup={fn()}
      onUse={proseDiscardMock}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Discarded suggestion text.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() =>
      expect(screen.queryByText('Discarded suggestion text.')).not.toBeInTheDocument(),
    )
    expect(proseDiscardMock).not.toHaveBeenCalled()
  },
}

const proseRefineCumulativeMock = fn()
export const ProseResult_RefineCumulative: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({ description: 'A quiet village wakes to strange lights.' })}
      refine={appendInstructionRefine}
      onSetup={fn()}
      onUse={proseRefineCumulativeMock}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('A quiet village wakes to strange lights.')).toBeInTheDocument()

    // First refine: 'current' is the original generation.
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    await userEvent.type(
      await screen.findByPlaceholderText('e.g. make it darker'),
      'make it darker',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    expect(
      await screen.findByText('A quiet village wakes to strange lights. / make it darker'),
    ).toBeInTheDocument()

    // Second refine: 'current' must be the FIRST refine's output, not the
    // original generation — this is what "cumulative" means.
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    await userEvent.type(await screen.findByPlaceholderText('e.g. make it darker'), 'add a storm')
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    expect(
      await screen.findByText(
        'A quiet village wakes to strange lights. / make it darker / add a storm',
      ),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))
    await waitFor(() =>
      expect(proseRefineCumulativeMock).toHaveBeenCalledWith({
        description: 'A quiet village wakes to strange lights. / make it darker / add a storm',
      }),
    )
  },
}

const proseCancelRefineMock = fn()
export const ProseResult_CancelRefineKeepsPreview: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({ description: 'The original generated take.' })}
      refine={neverResolvingRefine<DescriptionValue>()}
      onSetup={fn()}
      onUse={proseCancelRefineMock}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('The original generated take.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    await userEvent.type(await screen.findByPlaceholderText('e.g. make it darker'), 'darker')
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    expect(await screen.findByRole('progressbar', { name: 'Loading' })).toBeInTheDocument()

    // Cancelling an in-flight REFINE must return to the preview that was
    // already there, not the empty guidance screen — there's a generated
    // result to protect, unlike cancelling a first-time generate.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('The original generated take.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Use this' }))
    await waitFor(() =>
      expect(proseCancelRefineMock).toHaveBeenCalledWith({
        description: 'The original generated take.',
      }),
    )
  },
}

export const ProseResult_RefineLoadingKeepsRefineForm: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({ description: 'The original generated take.' })}
      refine={neverResolvingRefine<DescriptionValue>()}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.type(
      await screen.findByPlaceholderText('e.g. "a tense heist thriller"'),
      'moody',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('The original generated take.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    await userEvent.type(await screen.findByPlaceholderText('e.g. make it darker'), 'darker')
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    expect(await screen.findByRole('progressbar', { name: 'Loading' })).toBeInTheDocument()

    // An in-flight refine keeps the instruction that started it on screen.
    // Rendering the generate form instead would surface 'moody' — guidance from
    // an earlier, different call that the user is not currently answering.
    expect(screen.getByPlaceholderText('e.g. make it darker')).toHaveValue('darker')
    expect(screen.queryByPlaceholderText('e.g. "a tense heist thriller"')).not.toBeInTheDocument()
  },
}

const COMMITTED = { description: 'The prose already sitting in the field.' }

export const Committed_SeedsPreviewInsteadOfGuidance: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({ description: 'should not be reached' })}
      refine={neverResolvingRefine<DescriptionValue>()}
      committed={COMMITTED}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))

    // The committed prose IS the preview, so there is no guidance form to fill
    // and nothing to accept or throw away — only the two ways forward.
    expect(await screen.findByText(COMMITTED.description)).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('e.g. "a tense heist thriller"')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refine…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Use this' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Discard' })).not.toBeInTheDocument()
  },
}

export const Committed_EmptyStillOpensGuidance: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({ description: 'A generated take.' })}
      committed={{ description: '   ' }}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    // Whitespace is not content: an empty field has nothing to refine, so the
    // seed is refused and the generate path runs as if no committed prop existed.
    expect(await screen.findByPlaceholderText('e.g. "a tense heist thriller"')).toBeInTheDocument()
  },
}

const seededRefineCalls: { current: DescriptionValue; instruction: string }[] = []
export const Committed_RefineBuildsOnCommittedProse: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({ description: 'should not be reached' })}
      refine={async (current, instruction) => {
        seededRefineCalls.push({ current, instruction })
        return { status: 'ok', value: { description: 'The refined take.' } }
      }}
      committed={COMMITTED}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    seededRefineCalls.length = 0
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Refine…' }))
    await userEvent.type(await screen.findByPlaceholderText('e.g. make it darker'), 'darker')
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))

    // The committed prose is the refine base — this is the entry point canon
    // names for iterating on prose that is already in the field.
    expect(await screen.findByText('The refined take.')).toBeInTheDocument()
    expect(seededRefineCalls).toEqual([{ current: COMMITTED, instruction: 'darker' }])
    // A candidate exists now, so the accept/reject actions come back.
    expect(screen.getByRole('button', { name: 'Use this' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  },
}

const regenerateGuidanceCalls: string[] = []
export const ProseResult_RegeneratePreservesGuidance: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={guidanceCapturingRun<DescriptionValue>(
        { description: 'Same result either way.' },
        regenerateGuidanceCalls,
      )}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.type(
      screen.getByPlaceholderText('e.g. "a tense heist thriller"'),
      'moody and slow-burn',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Same result either way.')).toBeInTheDocument()

    // Regenerate carries no guidance UI of its own — it must replay the
    // guidance from the original generate, not an empty string.
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(regenerateGuidanceCalls).toHaveLength(2))
    expect(regenerateGuidanceCalls).toEqual(['moody and slow-burn', 'moody and slow-burn'])
  },
}

const chipsPickMock = fn()
export const ChipsResult: Story = {
  render: () => (
    <ChipsDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<TitlesValue>({
        titles: ['The Last Blockade', 'Smoke and Salt', 'Iron Tide'],
      })}
      onSetup={fn()}
      onPickChip={chipsPickMock}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest title' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('The Last Blockade')).toBeInTheDocument()
    expect(screen.getByText('Smoke and Salt')).toBeInTheDocument()
    expect(screen.getByText('Iron Tide')).toBeInTheDocument()

    await userEvent.click(screen.getByText('Smoke and Salt'))
    await waitFor(() =>
      expect(chipsPickMock).toHaveBeenCalledWith('Smoke and Salt', {
        titles: ['The Last Blockade', 'Smoke and Salt', 'Iron Tide'],
      }),
    )
    expect(await screen.findByText('Committed: Smoke and Salt')).toBeInTheDocument()
  },
}

export const Failure: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={failRun<DescriptionValue>('Provider request timed out after 3 retries')}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(
      await screen.findByText("Couldn't generate. Provider request timed out after 3 retries."),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  },
}

export const FailureThenRetrySucceeds: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={flakyThenOkRun<DescriptionValue>(
        { description: 'Recovered description after retry.' },
        'Provider request timed out after 3 retries',
      )}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(
      await screen.findByText("Couldn't generate. Provider request timed out after 3 retries."),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Recovered description after retry.')).toBeInTheDocument()
  },
}

const refineFailureGenerateCalls: string[] = []
const refineFailureRetryCalls: { current: DescriptionValue; instruction: string }[] = []
export const RefineFailureTryAgainRetriesRefine: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={guidanceCapturingRun<DescriptionValue>(
        { description: 'Original generated take.' },
        refineFailureGenerateCalls,
      )}
      refine={flakyThenOkRefine<DescriptionValue>(
        { description: 'Refined and recovered.' },
        'Provider request timed out after 3 retries',
        refineFailureRetryCalls,
      )}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.type(
      screen.getByPlaceholderText('e.g. "a tense heist thriller"'),
      'moody guidance',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Original generated take.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    await userEvent.type(await screen.findByPlaceholderText('e.g. make it darker'), 'darker please')
    await userEvent.click(screen.getByRole('button', { name: 'Refine…' }))
    expect(
      await screen.findByText("Couldn't generate. Provider request timed out after 3 retries."),
    ).toBeInTheDocument()

    // Try again must retry the REFINE that failed — same 'current', same
    // instruction — not fall back to a fresh generate with the old guidance.
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Refined and recovered.')).toBeInTheDocument()

    expect(refineFailureGenerateCalls).toEqual(['moody guidance'])
    expect(refineFailureRetryCalls).toEqual([
      { current: { description: 'Original generated take.' }, instruction: 'darker please' },
      { current: { description: 'Original generated take.' }, instruction: 'darker please' },
    ])
  },
}

export const NotConfigured: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => null}
      run={okRun<DescriptionValue>({ description: 'unreachable — never configured' })}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    expect(await screen.findByText('AI is not configured.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set up in Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  },
}

const notConfiguredSetupMock = fn()
export const NotConfigured_SetupClosesOverlay: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => null}
      run={okRun<DescriptionValue>({ description: 'unreachable — never configured' })}
      onSetup={notConfiguredSetupMock}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Set up in Settings' }))
    await waitFor(() => expect(notConfiguredSetupMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('AI is not configured.')).not.toBeInTheDocument()
  },
}

export const DisabledTrigger: Story = {
  render: () => (
    <View className="w-96 gap-3 rounded-md bg-bg-base p-6">
      <AiAssist
        ariaLabel="Suggest description"
        run={okRun<DescriptionValue>({ description: 'should never appear' })}
        resolveModelId={() => MODEL_ID}
        result="prose"
        getProse={(v) => v.description}
        onUse={fn()}
        onSetup={fn()}
        disabled
      />
    </View>
  ),
  play: async () => {
    const trigger = screen.getByRole('button', { name: 'Suggest description' })
    // The trigger is a bare Pressable, not an rn-primitives Trigger, so RN-Web's
    // own disabled handling supplies the pointer-events gate that
    // lessons-learned/rn-primitives-disabled.md has to work around elsewhere.
    expect(trigger).toHaveStyle({ pointerEvents: 'none' })
    // Nothing opened — no guidance chrome.
    expect(screen.queryByText('Optional guidance')).not.toBeInTheDocument()
  },
}

// useTier() reads the real browser window width, not a wrapper's — resize the
// Storybook preview below 640px to see the ✨ trigger open a bottom Sheet
// instead of a Modal (mirrors GenerationStatusPill's PhonePopover story).
export const PhoneSheetNote: Story = {
  render: () => (
    <View style={{ width: 360 }} className="gap-2 rounded-md bg-bg-base p-4">
      <Text variant="muted" size="sm">
        Resize the Storybook window itself below 640px to see the ✨ trigger open a bottom Sheet
        instead of a Modal.
      </Text>
      <ProseDemo
        resolveModelId={() => MODEL_ID}
        run={okRun<DescriptionValue>({ description: 'Phone-tier sample result.' })}
        onSetup={fn()}
        onUse={fn()}
      />
    </View>
  ),
}

const RUIN_ITEM: AssistListItem<ListPayload> = {
  name: 'Sunken Archive',
  detail: 'A flooded library beneath the old temple.',
  payload: { name: 'Sunken Archive', category: 'location', tags: ['ruins', 'flooded'] },
}
const FACTION_ITEM: AssistListItem<ListPayload> = {
  name: 'Ashfall Cartel',
  detail: 'Smugglers who trade in volcanic glass.',
  payload: { name: 'Ashfall Cartel', category: 'faction' },
}
const PAGE_TWO_ITEM: AssistListItem<ListPayload> = {
  name: 'Old Jorin',
  detail: 'The grizzled barkeeper of the Iron Tankard.',
  payload: { name: 'Old Jorin', category: 'character' },
}

export const ListResult_FirstPage: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<ListItemValue>({ items: [RUIN_ITEM, FACTION_ITEM] })}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Sunken Archive')).toBeInTheDocument()
    expect(screen.getByText('A flooded library beneath the old temple.')).toBeInTheDocument()
    expect(screen.getByText('Ashfall Cartel')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByRole('checkbox', { name: 'Sunken Archive' })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Ashfall Cartel' })).not.toBeChecked()
  },
}

export const ListResult_EmptyPageShowsEmptyCopy: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<ListItemValue>({ items: [] })}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(
      await screen.findByText('Nothing suggested. Try different guidance.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  },
}

const NOIR_ITEM: AssistListItem<ListPayload> = {
  name: 'Noir',
  detail: 'A moody detective drama.',
  payload: { name: 'Noir', category: 'genre' },
}
const NOIR_ITEM_WHITESPACE_VARIANT: AssistListItem<ListPayload> = {
  name: '  Noir  ',
  detail: 'A duplicate suggestion differing only by whitespace.',
  payload: { name: 'Noir', category: 'genre' },
}

export const ListResult_DedupesWhitespaceVariantWithinOnePage: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<ListItemValue>({ items: [NOIR_ITEM, NOIR_ITEM_WHITESPACE_VARIANT] })}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await screen.findByText('Noir')

    // The replace path (a first Generate / Regenerate) must dedupe exactly
    // like the append path (`Generate more`) — a reply containing the same
    // name twice, differing only by whitespace, renders as one row. Two rows
    // sharing a rendered name would collide on both the React `key` and the
    // `selected` Set key, so one click would check both.
    expect(screen.getAllByRole('checkbox', { name: 'Noir' })).toHaveLength(1)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Noir' }))
    expect(screen.getAllByRole('checkbox', { name: 'Noir', checked: true })).toHaveLength(1)
  },
}

const ASHFALL_LOCATION_ITEM: AssistListItem<ListPayload> = {
  name: 'Ashfall',
  detail: 'A city built on a dead volcano.',
  dedupeKey: composeKey('location', 'Ashfall'),
  payload: { name: 'Ashfall', category: 'location' },
}
const ASHFALL_FACTION_ITEM: AssistListItem<ListPayload> = {
  name: 'Ashfall',
  detail: 'A cult that worships the volcano.',
  dedupeKey: composeKey('faction', 'Ashfall'),
  payload: { name: 'Ashfall', category: 'faction' },
}

export const ListResult_SameNameDistinctDedupeKeysBothSelectable: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<ListItemValue>({ items: [ASHFALL_LOCATION_ITEM, ASHFALL_FACTION_ITEM] })}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await screen.findAllByText('Ashfall')

    // A location and a faction sharing a name are distinct rows once each
    // carries its own dedupeKey — unlike ListResult_DedupesWhitespaceVariant-
    // WithinOnePage above, this pair must NOT collapse to one. Both rows share
    // an accessible name (`accessibilityLabel={row.name}`), so they cannot be
    // addressed individually via getByRole(..., { name }); order is the only
    // available handle, matching `getItems`' emission order.
    const checkboxes = screen.getAllByRole('checkbox', { name: 'Ashfall' })
    expect(checkboxes).toHaveLength(2)

    await userEvent.click(checkboxes[0])
    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes[1]).not.toBeChecked()
  },
}

export const ListResult_GenerateMoreAppendsAndKeepsSelection: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={sequentialRun<ListItemValue>([
        { status: 'ok', value: { items: [RUIN_ITEM] } },
        { status: 'ok', value: { items: [PAGE_TWO_ITEM] } },
      ])}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sunken Archive' }))
    expect(screen.getByRole('checkbox', { name: 'Sunken Archive' })).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Generate more' }))
    expect(await screen.findByText('Old Jorin')).toBeInTheDocument()
    // Page one's row is still on screen AND still checked — `Generate more`
    // appends rather than replacing.
    expect(screen.getByRole('checkbox', { name: 'Sunken Archive' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Old Jorin' })).not.toBeChecked()
  },
}

const generateMoreExcludeCalls: (readonly string[])[] = []
export const ListResult_GenerateMoreExcludesRowsOnScreen: Story = {
  render: () => {
    generateMoreExcludeCalls.length = 0
    return (
      <ListDemo
        resolveModelId={() => MODEL_ID}
        run={excludeCapturingRun<ListItemValue>(
          [{ items: [RUIN_ITEM] }, { items: [PAGE_TWO_ITEM] }, { items: [FACTION_ITEM] }],
          generateMoreExcludeCalls,
        )}
        onSetup={fn()}
        onImport={fn()}
      />
    )
  },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await screen.findByText('Sunken Archive')
    // A fresh Generate is meant to re-roll, so it excludes nothing.
    expect(generateMoreExcludeCalls[0]).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Generate more' }))
    await screen.findByText('Old Jorin')
    // Without this the call re-sends page one's prompt verbatim and the reply
    // is deduped away — a wasted round-trip the user pays for.
    expect(generateMoreExcludeCalls[1]).toEqual(['Sunken Archive'])

    // Accumulates across pages rather than carrying only the newest one.
    await userEvent.click(screen.getByRole('button', { name: 'Generate more' }))
    await screen.findByText('Ashfall Cartel')
    expect(generateMoreExcludeCalls[2]).toEqual(['Sunken Archive', 'Old Jorin'])

    // Regenerate replaces rather than appends, so it re-rolls unconstrained.
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(generateMoreExcludeCalls).toHaveLength(4))
    expect(generateMoreExcludeCalls[3]).toEqual([])
  },
}

const kindScopedExcludeCalls: (readonly string[])[] = []
export const ListResult_ExcludeLabelCarriesTheScope: Story = {
  render: () => {
    kindScopedExcludeCalls.length = 0
    return (
      <ListDemo
        resolveModelId={() => MODEL_ID}
        run={excludeCapturingRun<ListItemValue>(
          [{ items: [ASHFALL_LOCATION_ITEM] }, { items: [ASHFALL_FACTION_ITEM] }],
          kindScopedExcludeCalls,
        )}
        excludeLabel={(item) => `${item.name.trim()} (${item.payload.category})`}
        onSetup={fn()}
        onImport={fn()}
      />
    )
  },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await screen.findByText('A city built on a dead volcano.')

    await userEvent.click(screen.getByRole('button', { name: 'Generate more' }))
    await screen.findByText('A cult that worships the volcano.')
    // Scope-qualified: a bare "Ashfall" would tell the model to suppress an
    // Ashfall of ANY kind — the exact collision the kind-scoped dedupeKey
    // exists to allow, so the two channels have to agree.
    expect(kindScopedExcludeCalls[1]).toEqual(['Ashfall (location)'])
  },
}

export const ListResult_ExistingNameDisabled: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<ListItemValue>({ items: [RUIN_ITEM, FACTION_ITEM] })}
      existingKeys={[nameKey('sunken archive')]}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await screen.findByText('Sunken Archive')
    expect(screen.getByText('(already exists)')).toBeInTheDocument()

    const existingCheckbox = screen.getByRole('checkbox', { name: 'Sunken Archive' })
    expect(existingCheckbox).toHaveStyle({ pointerEvents: 'none' })
    // Unlike an rn-primitives Trigger (lessons-learned/rn-primitives-disabled.md),
    // `disabled` alone genuinely blocks this: RN-Web's Pressable sets
    // pointer-events:none on the disabled root itself, so user-event's
    // actionability check refuses the click outright.
    await expect(userEvent.click(existingCheckbox)).rejects.toThrow(/pointer-events/)
    expect(existingCheckbox).not.toBeChecked()

    // The other row is unaffected — still selectable normally.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Ashfall Cartel' }))
    expect(screen.getByRole('checkbox', { name: 'Ashfall Cartel' })).toBeChecked()
  },
}

const importSelectedMock = fn()
export const ListResult_ImportSelectedReportsCheckedRowsAndCloses: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<ListItemValue>({ items: [RUIN_ITEM, FACTION_ITEM] })}
      onSetup={fn()}
      onImport={importSelectedMock}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sunken Archive' }))
    // Ashfall Cartel deliberately left unchecked.

    await userEvent.click(screen.getByRole('button', { name: 'Import selected' }))
    await waitFor(() => expect(importSelectedMock).toHaveBeenCalledWith([RUIN_ITEM.payload]))
    expect(await screen.findByText('Imported: Sunken Archive')).toBeInTheDocument()
    // The overlay closed — its chrome is gone from the DOM.
    expect(screen.queryByText('Ashfall Cartel')).not.toBeInTheDocument()
  },
}

export const ListResult_FailedGenerateMoreKeepsPageAndAppendsOnRetry: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={sequentialRun<ListItemValue>([
        { status: 'ok', value: { items: [RUIN_ITEM] } },
        { status: 'failed', detail: 'Provider request timed out after 3 retries' },
        { status: 'ok', value: { items: [PAGE_TWO_ITEM] } },
      ])}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sunken Archive' }))

    await userEvent.click(screen.getByRole('button', { name: 'Generate more' }))
    expect(
      await screen.findByText("Couldn't generate. Provider request timed out after 3 retries."),
    ).toBeInTheDocument()

    // Try again must retry the SAME `Generate more` call — appending, not
    // replacing — and page one's checked row must survive the failure
    // screen untouched, since `listItems`/`selected` are separate state
    // `runCall` never clobbers on a failure branch.
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Old Jorin')).toBeInTheDocument()
    expect(screen.getByText('Sunken Archive')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Sunken Archive' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Old Jorin' })).not.toBeChecked()
  },
}

export const ListResult_FailedFirstGenerateThenRetrySucceedsWithExactPage: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={sequentialRun<ListItemValue>([
        { status: 'failed', detail: 'Provider request timed out after 3 retries' },
        { status: 'ok', value: { items: [RUIN_ITEM, FACTION_ITEM] } },
      ])}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(
      await screen.findByText("Couldn't generate. Provider request timed out after 3 retries."),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    // Exactly page one's two rows — a failed FIRST Generate must leave an
    // empty list, not a stale one the eventual success then accumulates onto.
    expect(await screen.findByText('Sunken Archive')).toBeInTheDocument()
    expect(screen.getByText('Ashfall Cartel')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  },
}

export const ListResult_DismissalClearsSelectionForNextOpen: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<ListItemValue>({ items: [RUIN_ITEM] })}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sunken Archive' }))
    expect(screen.getByRole('checkbox', { name: 'Sunken Archive' })).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByText('Sunken Archive')).not.toBeInTheDocument())

    // Reopen and generate the SAME name again — if `selected` leaked past the
    // dismissal, this row would render pre-checked (lessons-learned/no-harmless-id-leaks.md).
    // Two clears cover this — `resetOnClose` and the replace branch of `runCall`
    // — so this pins the outcome, not either one alone; each survives removal.
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByRole('checkbox', { name: 'Sunken Archive' })).not.toBeChecked()
  },
}

export const ListResult_RegenerateReplacesGenerateMoreAppends: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={sequentialRun<ListItemValue>([
        { status: 'ok', value: { items: [RUIN_ITEM] } },
        { status: 'ok', value: { items: [PAGE_TWO_ITEM] } },
        { status: 'ok', value: { items: [FACTION_ITEM] } },
      ])}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sunken Archive' }))

    await userEvent.click(screen.getByRole('button', { name: 'Generate more' }))
    expect(await screen.findByText('Old Jorin')).toBeInTheDocument()
    expect(screen.getByText('Sunken Archive')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    // Regenerate replaces the whole page — both prior rows are gone, only
    // the fresh generation remains — unlike `Generate more` above.
    await waitFor(() => expect(screen.getByText('Ashfall Cartel')).toBeInTheDocument())
    expect(screen.queryByText('Sunken Archive')).not.toBeInTheDocument()
    expect(screen.queryByText('Old Jorin')).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  },
}

export const ListResult_RegenerateClearsSelectionForReusedName: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={sequentialRun<ListItemValue>([
        { status: 'ok', value: { items: [RUIN_ITEM] } },
        { status: 'ok', value: { items: [RUIN_ITEM] } },
      ])}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sunken Archive' }))
    expect(screen.getByRole('checkbox', { name: 'Sunken Archive' })).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    // A fresh batch coincidentally reusing a name from the discarded page
    // must not resurrect its checkmark — the same no-harmless-id-leaks class
    // dismissal guards against, one step narrower: within the same open
    // session instead of across a reopen.
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Sunken Archive' })).not.toBeChecked(),
    )
  },
}

export const ListResult_CancelledGenerateMoreThenRegenerateReplaces: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={okHangThenOkRun<ListItemValue>({ items: [RUIN_ITEM] }, { items: [FACTION_ITEM] })}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sunken Archive' }))

    await userEvent.click(screen.getByRole('button', { name: 'Generate more' }))
    expect(await screen.findByRole('progressbar', { name: 'Loading' })).toBeInTheDocument()
    // Cancelling a Regenerate/Generate more restores the page it ran on top of
    // rather than dropping to the guidance form — the load was additive, so the
    // user keeps what they already had, checkmarks included.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByText('Sunken Archive')).toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: 'Sunken Archive' })).toBeChecked()

    // Cancel also clears the append flag. Without that, this Regenerate would
    // merge into the leftover page instead of replacing it.
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(screen.getByText('Ashfall Cartel')).toBeInTheDocument())
    expect(screen.queryByText('Sunken Archive')).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    expect(screen.getByRole('checkbox', { name: 'Ashfall Cartel' })).not.toBeChecked()
  },
}

let setLiveExistingKeys: (keys: DedupeKey[]) => void = () => {}
export const ListResult_CheckedRowLaterMarkedExistingStaysBlocked: Story = {
  render: () => (
    <ListDemoWithLiveExisting
      resolveModelId={() => MODEL_ID}
      run={okRun<ListItemValue>({ items: [RUIN_ITEM] })}
      onReady={(setter) => {
        setLiveExistingKeys = setter
      }}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sunken Archive' }))
    expect(screen.getByRole('checkbox', { name: 'Sunken Archive' })).toBeChecked()

    // Marking it existing WHILE checked reaches a combination a static
    // existingKeys prop never produces: checked AND disabled together, with
    // the Indicator wrapper actually rendered. Driven directly through the
    // setter (not a click) — a button outside DialogContent would register
    // as an outside interaction and dismiss the overlay before this
    // assertion ever ran.
    setLiveExistingKeys([nameKey('Sunken Archive')])
    const checkbox = await screen.findByRole('checkbox', { name: 'Sunken Archive' })
    expect(checkbox).toBeChecked()
    expect(checkbox).toHaveStyle({ pointerEvents: 'none' })
    await expect(userEvent.click(checkbox)).rejects.toThrow(/pointer-events/)
    expect(checkbox).toBeChecked()

    // The Indicator wrapper is a rendered DIRECT child now, not absent — the
    // element RN-Web's box-none reopens to `pointer-events: auto` for direct
    // children. Radix's own CheckboxIndicator forces pointer-events:none on
    // itself regardless, so clicking it directly is refused too.
    const indicator = checkbox.firstElementChild
    if (indicator == null) throw new Error('expected a rendered Indicator wrapper on a checked row')
    await expect(userEvent.click(indicator)).rejects.toThrow(/pointer-events/)
    expect(checkbox).toBeChecked()

    // The selection is non-empty but every member of it now exists, so there is
    // nothing left to import: the button must not offer an import that would
    // pass an empty array and close the overlay as if it had done something.
    expect(screen.getByRole('button', { name: 'Import selected' })).toBeDisabled()
  },
}

// Escape / tap-outside / swipe all arrive as onOpenChange(false). A landed
// result is the user's work; it is confirmed away, not lost to a stray key.
export const DirtyDismissAsksBeforeDiscarding: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({ description: 'Kept suggestion text.' })}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await screen.findByText('Kept suggestion text.')

    await userEvent.keyboard('{Escape}')
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
    // The overlay comes back with the result still in it.
    expect(await screen.findByText('Kept suggestion text.')).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    const again = await screen.findByRole('alertdialog')
    await userEvent.click(within(again).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByText('Kept suggestion text.')).not.toBeInTheDocument())
    // Reopening starts clean — the discard really cleared the state.
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    expect(await screen.findByText('Optional guidance')).toBeInTheDocument()
  },
}

// Radix suppresses its own auto-focus and focuses whatever registered as Cancel; a footer of
// bare Buttons leaves focus on <body>, so the trap never engages — Tab walks out to the trigger
// behind the dialog and Enter destroys the result unasked.
export const DirtyDismissTrapsFocusInTheConfirm: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({ description: 'Focus-trap suggestion text.' })}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await screen.findByText('Focus-trap suggestion text.')

    await userEvent.keyboard('{Escape}')
    const dialog = await screen.findByRole('alertdialog')
    const focusIsInDialog = () => dialog.contains(document.activeElement)
    await waitFor(() => expect(focusIsInDialog()).toBe(true))

    // Tabbing cannot reach the trigger behind it, so Enter cannot discard blind.
    await userEvent.tab()
    expect(focusIsInDialog()).toBe(true)
    await userEvent.tab()
    expect(focusIsInDialog()).toBe(true)
  },
}

// The failure card's Cancel is an explicit dismiss, but a failure never clears the list —
// only the ok branch writes it — so it is the one explicit path that can still destroy work.
export const FailureCancelKeepingAListAsksBeforeDiscarding: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={sequentialRun<ListItemValue>([
        { status: 'ok', value: { items: [RUIN_ITEM] } },
        { status: 'failed', detail: 'Provider request timed out after 3 retries' },
        { status: 'ok', value: { items: [PAGE_TWO_ITEM] } },
      ])}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sunken Archive' }))
    await userEvent.click(screen.getByRole('button', { name: 'Generate more' }))
    await screen.findByText("Couldn't generate. Provider request timed out after 3 retries.")

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }))

    // The failure card renders in place of the list, so the surviving page only becomes
    // visible again on retry — which is also the proof that Keep discarded nothing.
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Old Jorin')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Sunken Archive' })).toBeChecked()
  },
}

// The other half: with nothing generated there is nothing to lose, so the same button must
// still close outright — otherwise the guard is just an unconditional prompt.
export const FailureCancelWithNothingGeneratedClosesOutright: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={failRun<DescriptionValue>('Provider request timed out after 3 retries')}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await screen.findByText("Couldn't generate. Provider request timed out after 3 retries.")

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() =>
      expect(
        screen.queryByText("Couldn't generate. Provider request timed out after 3 retries."),
      ).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
}

// The two carve-outs the dirty predicate leads with, each on its own: a seeded
// preview is the field's own prose, and a first generate has produced nothing.
export const SeededPreviewDismissesWithoutAsking: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okRun<DescriptionValue>({ description: 'should not be reached' })}
      committed={COMMITTED}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await screen.findByText(COMMITTED.description)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText(COMMITTED.description)).not.toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
}

export const FirstGenerateInFlightDismissesWithoutAsking: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={neverResolvingRun<DescriptionValue>()}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  },
}

export const CleanDismissClosesWithoutAsking: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={neverResolvingRun<DescriptionValue>()}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await screen.findByText('Optional guidance')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('Optional guidance')).not.toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  },
}

// A generated page with nothing ticked is still work: `selected` only ever holds
// keys that came from `listItems`, so the list half of the dirty test is the half
// that has to hold on its own.
export const FailureCancelKeepingAnUntouchedListAsksBeforeDiscarding: Story = {
  render: () => (
    <ListDemo
      resolveModelId={() => MODEL_ID}
      run={sequentialRun<ListItemValue>([
        { status: 'ok', value: { items: [RUIN_ITEM] } },
        { status: 'failed', detail: 'Provider request timed out after 3 retries' },
        { status: 'ok', value: { items: [PAGE_TWO_ITEM] } },
      ])}
      onSetup={fn()}
      onImport={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await screen.findByText('Sunken Archive')
    // Deliberately no checkbox click — the page exists, the selection is empty.
    await userEvent.click(screen.getByRole('button', { name: 'Generate more' }))
    await screen.findByText("Couldn't generate. Provider request timed out after 3 retries.")

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  },
}

// The confirm's Discard is a separate reset path, and reopening re-seeds `assist`
// while a fresh Generate re-clears `selected` — so the abort is the only part of
// the reset that nothing downstream redoes.
let discardAbortSignals: AbortSignal[] = []

export const ConfirmDiscardAbortsTheInFlightCall: Story = {
  render: () => {
    discardAbortSignals = []
    let call = 0
    return (
      <ListDemo
        resolveModelId={() => MODEL_ID}
        run={(_guidance, signal) => {
          discardAbortSignals.push(signal)
          call += 1
          // Page one lands so the overlay is dirty; the Generate more behind the
          // confirm is what must still be in flight when Discard runs.
          if (call === 1) return Promise.resolve({ status: 'ok', value: { items: [RUIN_ITEM] } })
          return new Promise(() => {})
        }}
        onSetup={fn()}
        onImport={fn()}
      />
    )
  },
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest lore' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await screen.findByText('Sunken Archive')
    await userEvent.click(screen.getByRole('button', { name: 'Generate more' }))

    await userEvent.keyboard('{Escape}')
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard' }))

    await waitFor(() => expect(discardAbortSignals.at(-1)?.aborted).toBe(true))
  },
}

// The 'loading' arm carries the previous candidate in `from`, and both of its
// clauses decide alone: an uncommitted candidate is still losable mid-regenerate…
export const RegenerateInFlightOverACandidateAsksBeforeDiscarding: Story = {
  render: () => (
    <ProseDemo
      resolveModelId={() => MODEL_ID}
      run={okHangThenOkRun<DescriptionValue>(
        { description: 'First candidate.' },
        { description: 'unreachable — the regenerate never settles' },
      )}
      onSetup={fn()}
      onUse={fn()}
    />
  ),
  play: async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Suggest description' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    await screen.findByText('First candidate.')
    await userEvent.click(screen.getByRole('button', { name: 'Regenerate' }))

    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  },
}
