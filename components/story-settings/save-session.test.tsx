// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

import { StorySettingsStaleStoreError } from '@/lib/actions'
import { STORY_SETTINGS_DEFAULTS, type StorySettings } from '@/lib/db'

import {
  StorySettingsSaveSessionProvider,
  useStorySettingsSaveSession,
  useStorySettingsSection,
  type SaveOutcome,
  type SaveSessionApi,
} from './save-session'
import { type SectionDirtyState } from './save-session-state'
import { type StorySettingsTabId } from './tabs'

// The publish loop has two independent guards: the effect's serialized dirty
// key, and upsertSection returning the same array reference for an unchanged
// republish. The second alone stops the loop, which makes the first
// unfalsifiable — so one test neutralizes it to exercise the first in isolation.
const guard = vi.hoisted(() => ({ breakArrayIdentity: false }))

type UpsertSection = (
  sections: readonly SectionDirtyState[],
  next: SectionDirtyState,
) => readonly SectionDirtyState[]

vi.mock('./save-session-state', async (importOriginal) => {
  const actual = (await importOriginal()) as { upsertSection: UpsertSection }
  return {
    ...actual,
    upsertSection: (sections: readonly SectionDirtyState[], next: SectionDirtyState) => {
      const result = actual.upsertSection(sections, next)
      return guard.breakArrayIdentity && result === sections ? [...sections] : result
    },
  }
})

afterEach(() => {
  guard.breakArrayIdentity = false
  cleanup()
  vi.restoreAllMocks()
})

const COLLISION = 'both patch the top-level key'

type SectionFixture = {
  id: string
  tab: StorySettingsTabId
  dirtyFields: readonly string[]
  getPatch: Mock<() => Partial<StorySettings>>
  reset: Mock<() => void>
  invalidReason?: string
}

function makeSection(
  id: string,
  tab: StorySettingsTabId,
  dirtyFields: readonly string[],
  patch: Partial<StorySettings> = {},
): SectionFixture {
  return { id, tab, dirtyFields, getPatch: vi.fn(() => patch), reset: vi.fn() }
}

function Section({ fixture }: { fixture: SectionFixture }) {
  useStorySettingsSection({
    id: fixture.id,
    tab: fixture.tab,
    dirtyFields: fixture.dirtyFields,
    getPatch: fixture.getPatch,
    reset: fixture.reset,
    invalidReason: fixture.invalidReason,
  })
  return null
}

function Capture({ held }: { held: { current: SaveSessionApi | null } }) {
  held.current = useStorySettingsSaveSession()
  return null
}

type MountOptions = {
  children?: ReactNode
  onCommit?: Mock<() => Promise<unknown>>
  onSaved?: Mock<() => void>
  onSaveFailed?: Mock<(error: unknown) => void>
}

function mountSession(options: MountOptions = {}) {
  const onCommit = options.onCommit ?? vi.fn(() => Promise.resolve())
  const onSaved = options.onSaved ?? vi.fn()
  const onSaveFailed = options.onSaveFailed ?? vi.fn()
  const held: { current: SaveSessionApi | null } = { current: null }

  const tree = (children: ReactNode) => (
    <StorySettingsSaveSessionProvider
      onCommit={onCommit}
      onSaved={onSaved}
      onSaveFailed={onSaveFailed}
    >
      {children}
      <Capture held={held} />
    </StorySettingsSaveSessionProvider>
  )

  const view = render(tree(options.children))

  return {
    onCommit,
    onSaved,
    onSaveFailed,
    api: () => held.current!,
    rerenderWith: (children: ReactNode) => view.rerender(tree(children)),
  }
}

function sectionsOf(...fixtures: SectionFixture[]) {
  return fixtures.map((fixture) => <Section key={fixture.id} fixture={fixture} />)
}

/**
 * A section handing the hook a brand-new `dirtyFields` array on every render —
 * the shape that would re-fire the publish effect forever if the guards broke.
 * Throws past a render ceiling so a regression fails loudly instead of hanging
 * the run: an unguarded publish loop never yields to the test timeout.
 */
function churningSection(renders: { count: number }) {
  return function ChurningSection() {
    renders.count += 1
    useStorySettingsSection({
      id: 'authoring-aids',
      tab: 'generation',
      dirtyFields: ['suggestions', 'suggestion count'].slice(),
      getPatch: () => ({ suggestionsEnabled: true }),
      reset: () => {},
    })
    if (renders.count > 25) throw new Error(`publish loop: ${renders.count} renders`)
    return null
  }
}

describe('StorySettingsSaveSessionProvider — save', () => {
  it('commits every registered section as ONE merged write', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const memory = makeSection('embedding-status', 'memory', ['embedder'], {
      embedding_model_id: 'Xenova/all-MiniLM-L6-v2',
    })
    const chapters = makeSection('chapters', 'advanced', ['chapter threshold'], {
      chapterTokenThreshold: 9000,
    })
    const session = mountSession({ children: sectionsOf(aids, memory, chapters) })

    await act(async () => {
      await session.api().save()
    })

    expect(session.onCommit).toHaveBeenCalledTimes(1)
    expect(session.onCommit).toHaveBeenCalledWith({
      suggestionsEnabled: true,
      embedding_model_id: 'Xenova/all-MiniLM-L6-v2',
      chapterTokenThreshold: 9000,
    })
  })

  it('reports a committed write and resets every section after a successful save', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const memory = makeSection('embedding-status', 'memory', ['embedder'], {
      embeddingBackend: 'local',
    })
    const session = mountSession({ children: sectionsOf(aids, memory) })

    let outcome: SaveOutcome | undefined
    await act(async () => {
      outcome = await session.api().save()
    })

    expect(outcome?.status).toBe('committed')
    expect(aids.reset).toHaveBeenCalledTimes(1)
    expect(memory.reset).toHaveBeenCalledTimes(1)
    expect(session.onSaved).toHaveBeenCalledTimes(1)
    expect(session.onSaveFailed).not.toHaveBeenCalled()
  })

  it('keeps every draft intact when the commit rejects', async () => {
    const failure = new Error('write failed')
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const memory = makeSection('embedding-status', 'memory', ['embedder'], {
      embeddingBackend: 'local',
    })
    const session = mountSession({
      children: sectionsOf(aids, memory),
      onCommit: vi.fn(() => Promise.reject(failure)),
    })

    let outcome: SaveOutcome | undefined
    await act(async () => {
      outcome = await session.api().save()
    })

    expect(outcome?.status).toBe('rejected')
    expect(session.onSaveFailed).toHaveBeenCalledWith(failure)
    expect(session.onSaved).not.toHaveBeenCalled()
    expect(aids.reset).not.toHaveBeenCalled()
    expect(memory.reset).not.toHaveBeenCalled()
  })

  // The write is on disk; only the store re-read failed. Reporting `false`
  // would break save()'s own contract and, worse, strand a leave waiting on it
  // — the user would be told to Save/Discard changes already persisted.
  it('treats a stale store as a landed write and settles a waiting leave', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const stale = new StorySettingsStaleStoreError()
    const session = mountSession({
      children: sectionsOf(aids),
      onCommit: vi.fn(() => Promise.reject(stale)),
    })
    const proceed = vi.fn()

    act(() => session.api().requestLeave(proceed))
    await act(async () => {
      await expect(session.api().save()).resolves.toMatchObject({
        status: 'committed',
        storeStale: true,
      })
    })

    expect(session.onSaveFailed).toHaveBeenCalledWith(stale)
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(session.api().pendingLeave).toBe(false)
    // Re-deriving would read the store's pre-save values, so the draft stands.
    expect(aids.reset).not.toHaveBeenCalled()
    expect(session.onSaved).not.toHaveBeenCalled()
  })

  it('skips a clean section rather than trusting it to return an empty patch', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const memory = makeSection('embedding-status', 'memory', [], {
      embedding_model_id: 'Xenova/all-MiniLM-L6-v2',
    })
    const session = mountSession({ children: sectionsOf(aids, memory) })

    await act(async () => {
      await session.api().save()
    })

    expect(memory.getPatch).not.toHaveBeenCalled()
    expect(session.onCommit).toHaveBeenCalledExactlyOnceWith({ suggestionsEnabled: true })
  })

  it('commits the newest getPatch and reset closures, not the ones from mount', async () => {
    const resets: number[] = []
    function CountSection({ count }: { count: number }) {
      useStorySettingsSection({
        id: 'authoring-aids',
        tab: 'generation',
        dirtyFields: ['suggestion count'],
        getPatch: () => ({ suggestionCount: count }),
        reset: () => resets.push(count),
      })
      return null
    }

    const session = mountSession({ children: <CountSection count={3} /> })
    act(() => {
      session.rerenderWith(<CountSection count={5} />)
    })

    await act(async () => {
      await session.api().save()
    })

    expect(session.onCommit).toHaveBeenCalledExactlyOnceWith({ suggestionCount: 5 })
    expect(resets).toEqual([5])
  })

  it('turns away a second save while one is already in flight', async () => {
    // Every commit gets released, not just the last: a regression must fail on
    // the call-count assertion rather than deadlocking on an orphaned promise.
    const releases: (() => void)[] = []
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({
      children: sectionsOf(aids),
      onCommit: vi.fn(() => new Promise<void>((resolve) => releases.push(resolve))),
    })

    let inFlight: Promise<SaveOutcome> | undefined
    let second: Promise<SaveOutcome> | undefined
    await act(async () => {
      inFlight = session.api().save()
      second = session.api().save()
    })

    expect(session.api().saving).toBe(true)

    let outcomes: SaveOutcome[] = []
    await act(async () => {
      for (const release of releases) release()
      outcomes = await Promise.all([inFlight!, second!])
    })

    expect(session.onCommit).toHaveBeenCalledTimes(1)
    expect(outcomes.map((o) => o.status)).toEqual(['committed', 'busy'])
    expect(aids.reset).toHaveBeenCalledTimes(1)
    expect(session.onSaved).toHaveBeenCalledTimes(1)
  })

  // The merge is shallow, so the loser's slice is gone and `stories` has no
  // delta to recover it. Refusing the save is the only outcome that keeps both.
  it('refuses the save when two sections patch the same top-level key', async () => {
    const composer = makeSection('composer', 'generation', ['translation'], {
      translation: { ...STORY_SETTINGS_DEFAULTS.translation, enabled: true },
    })
    const languages = makeSection('languages', 'translation', ['granular toggles'], {
      translation: { ...STORY_SETTINGS_DEFAULTS.translation, targetLanguage: 'cs' },
    })
    const session = mountSession({ children: sectionsOf(composer, languages) })

    await act(async () => {
      await expect(session.api().save()).resolves.toMatchObject({ status: 'rejected' })
    })

    expect(session.onCommit).not.toHaveBeenCalled()
    expect(composer.reset).not.toHaveBeenCalled()
    expect(languages.reset).not.toHaveBeenCalled()
    const [error] = session.onSaveFailed.mock.calls[0] as [Error]
    expect(error.message).toContain(COLLISION)
    expect(error.message).toContain('"composer" and "languages"')
    expect(error.message).toContain('"translation"')
  })

  it('stays quiet when every section patches a distinct top-level key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
      suggestionCount: 5,
    })
    const memory = makeSection('embedding-status', 'memory', ['embedder'], {
      embeddingBackend: 'local',
    })
    const session = mountSession({ children: sectionsOf(aids, memory) })

    await act(async () => {
      await session.api().save()
    })

    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining(COLLISION))
  })

  it('clears the saving flag after a successful save', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({ children: sectionsOf(aids) })
    expect(session.api().saving).toBe(false)

    await act(async () => {
      await session.api().save()
    })

    expect(session.api().saving).toBe(false)
  })

  it('does not write, or claim a save, when the session is clean', async () => {
    const aids = makeSection('authoring-aids', 'generation', [])
    const session = mountSession({ children: sectionsOf(aids) })

    let outcome: SaveOutcome | undefined
    await act(async () => {
      outcome = await session.api().save()
    })

    expect(outcome?.status).toBe('noop')
    expect(session.onCommit).not.toHaveBeenCalled()
    expect(session.onSaved).not.toHaveBeenCalled()
    expect(aids.reset).not.toHaveBeenCalled()
  })

  it('leaves an edit made during the commit dirty instead of resetting it away', async () => {
    const releases: (() => void)[] = []
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const late = makeSection('embedding-status', 'memory', [], { embeddingBackend: 'local' })
    const session = mountSession({
      children: sectionsOf(aids, late),
      onCommit: vi.fn(() => new Promise<void>((resolve) => releases.push(resolve))),
    })

    let inFlight: Promise<SaveOutcome> | undefined
    await act(async () => {
      inFlight = session.api().save()
    })

    // The user keeps typing in a second section while the write is in flight.
    const lateDirty = { ...late, dirtyFields: ['embedder'] }
    act(() => {
      session.rerenderWith(sectionsOf(aids, lateDirty))
    })

    await act(async () => {
      releases.forEach((release) => release())
      await inFlight
    })

    expect(session.onCommit).toHaveBeenCalledExactlyOnceWith({ suggestionsEnabled: true })
    expect(aids.reset).toHaveBeenCalledTimes(1)
    // Neither committed nor reset: the edit landed after getPatch ran, so it
    // survives to the next save instead of being re-derived away.
    expect(late.getPatch).not.toHaveBeenCalled()
    expect(late.reset).not.toHaveBeenCalled()
    expect(session.api().snapshot.dirtyFields).toContain('embedder')
  })

  it('leaves a section the user kept editing during its own commit dirty', async () => {
    // The section is dirty at save time, so it IS committed — and then edited
    // again before the write lands. Resetting it would re-derive the draft back
    // to the values just written and drop the newer edit.
    const releases: (() => void)[] = []
    const draft = { current: 3 }
    const reset = vi.fn()
    function CountSection() {
      useStorySettingsSection({
        id: 'authoring-aids',
        tab: 'generation',
        dirtyFields: ['suggestion count'],
        getPatch: () => ({ suggestionCount: draft.current }),
        reset,
      })
      return null
    }

    const session = mountSession({
      children: <CountSection />,
      onCommit: vi.fn(() => new Promise<void>((resolve) => releases.push(resolve))),
    })

    let inFlight: Promise<SaveOutcome> | undefined
    await act(async () => {
      inFlight = session.api().save()
    })

    draft.current = 5
    const proceed = vi.fn()
    act(() => session.api().requestLeave(proceed))

    await act(async () => {
      releases.forEach((release) => release())
      await inFlight
    })

    expect(session.onCommit).toHaveBeenCalledExactlyOnceWith({ suggestionCount: 3 })
    expect(reset).not.toHaveBeenCalled()
    // The session is not clean, so a leave waiting on this save must not run.
    expect(proceed).not.toHaveBeenCalled()
    expect(session.api().pendingLeave).toBe(true)
  })

  it('reports a committed write as saved even when a post-commit step throws', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const onSaved = vi.fn(() => {
      throw new Error('toast blew up')
    })
    const session = mountSession({ children: sectionsOf(aids), onSaved })

    let outcome: SaveOutcome | undefined
    await act(async () => {
      outcome = await session.api().save()
    })

    expect(session.onCommit).toHaveBeenCalledTimes(1)
    expect(outcome?.status).toBe('committed')
    expect(session.onSaveFailed).not.toHaveBeenCalled()
  })

  it('resets the remaining sections when one section’s reset throws', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    aids.reset.mockImplementation(() => {
      throw new Error('reset blew up')
    })
    const memory = makeSection('embedding-status', 'memory', ['embedder'], {
      embeddingBackend: 'local',
    })
    const session = mountSession({ children: sectionsOf(aids, memory) })

    let outcome: SaveOutcome | undefined
    await act(async () => {
      outcome = await session.api().save()
    })

    expect(memory.reset).toHaveBeenCalledTimes(1)
    expect(outcome?.status).toBe('committed')
    expect(session.onSaveFailed).not.toHaveBeenCalled()
  })

  it('names the section whose getPatch throws', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'])
    aids.getPatch.mockImplementation(() => {
      throw new Error('draft is malformed')
    })
    const session = mountSession({ children: sectionsOf(aids) })

    let outcome: SaveOutcome | undefined
    await act(async () => {
      outcome = await session.api().save()
    })

    expect(outcome?.status).toBe('rejected')
    expect(session.onCommit).not.toHaveBeenCalled()
    expect(session.onSaveFailed).toHaveBeenCalledOnce()
    expect(String(session.onSaveFailed.mock.calls[0]?.[0])).toContain('authoring-aids')
  })
})

describe('StorySettingsSaveSessionProvider — discard', () => {
  it('resets every section without writing', () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const memory = makeSection('embedding-status', 'memory', ['embedder'], {
      embeddingBackend: 'local',
    })
    const session = mountSession({ children: sectionsOf(aids, memory) })

    act(() => session.api().discard())

    expect(aids.reset).toHaveBeenCalledTimes(1)
    expect(memory.reset).toHaveBeenCalledTimes(1)
    expect(session.onCommit).not.toHaveBeenCalled()
  })
})

describe('StorySettingsSaveSessionProvider — snapshot', () => {
  it('is clean with no registered sections', () => {
    const session = mountSession()
    expect(session.api().snapshot).toEqual({ dirtyFields: [] })
  })

  it('is clean while every registered section is clean', () => {
    const aids = makeSection('authoring-aids', 'generation', [])
    const memory = makeSection('embedding-status', 'memory', [])
    const session = mountSession({ children: sectionsOf(aids, memory) })

    expect(session.api().snapshot).toEqual({ dirtyFields: [] })
  })

  it('aggregates dirty fields across sections in rail order, not mount order', () => {
    const memory = makeSection('embedding-status', 'memory', ['embedder'])
    const aids = makeSection('authoring-aids', 'generation', ['suggestions', 'suggestion count'])
    const session = mountSession({ children: sectionsOf(memory, aids) })

    expect(session.api().snapshot).toEqual({
      dirtyFields: ['suggestions', 'suggestion count', 'embedder'],
    })
  })

  // Ids run reverse-alphabetical to rail order on purpose: with equal ranks the
  // id tie-break would order these the other way, so a tab that stopped driving
  // the rank can't hide behind the test above.
  it('ranks a section by its tab, not by its id', () => {
    const later = makeSection('aaa-embedder', 'memory', ['embedder'])
    const earlier = makeSection('zzz-suggestions', 'generation', ['suggestions'])
    const session = mountSession({ children: sectionsOf(later, earlier) })

    expect(session.api().snapshot.dirtyFields).toEqual(['suggestions', 'embedder'])
  })

  it('tracks a section that goes dirty after mount', () => {
    const aids = makeSection('authoring-aids', 'generation', [])
    const session = mountSession({ children: sectionsOf(aids) })
    expect(session.api().snapshot.dirtyFields).toEqual([])

    act(() => {
      session.rerenderWith(sectionsOf({ ...aids, dirtyFields: ['suggestions'] }))
    })

    expect(session.api().snapshot).toEqual({
      dirtyFields: ['suggestions'],
    })
  })
})

describe('StorySettingsSaveSessionProvider — unmount', () => {
  it('drops an unmounted section from the snapshot and from the merged write', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const memory = makeSection('embedding-status', 'memory', ['embedder'], {
      embeddingBackend: 'local',
    })
    const session = mountSession({ children: sectionsOf(aids, memory) })
    expect(session.api().snapshot.dirtyFields).toHaveLength(2)

    act(() => {
      session.rerenderWith(sectionsOf(aids))
    })

    expect(session.api().snapshot).toEqual({
      dirtyFields: ['suggestions'],
    })

    await act(async () => {
      await session.api().save()
    })

    expect(memory.getPatch).not.toHaveBeenCalled()
    expect(memory.reset).not.toHaveBeenCalled()
    expect(session.onCommit).toHaveBeenCalledExactlyOnceWith({ suggestionsEnabled: true })
  })

  it('refuses two live sections registering the same id', () => {
    // Two slices can independently pick the same free-form id on a seam built
    // for independent extension. Every registry is id-keyed, so the loser is
    // unreconstructable — the surface has to fail loudly instead of dropping it.
    const first = makeSection('authoring-aids', 'generation', ['suggestions'])
    const second = makeSection('authoring-aids', 'generation', ['suggestions'])

    expect(() =>
      mountSession({
        children: [
          <Section key="first" fixture={first} />,
          <Section key="second" fixture={second} />,
        ],
      }),
    ).toThrow(/registered the id "authoring-aids"/)
  })

  it('lets a remount reuse the id of the section it replaces', () => {
    // The duplicate check must not fire on a tab panel remounting, which is a
    // detach followed by an attach on the same id rather than two live claims.
    const first = makeSection('authoring-aids', 'generation', ['suggestions'])
    const replacement = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({ children: sectionsOf(first) })

    expect(() => {
      act(() => session.rerenderWith(null))
      act(() => session.rerenderWith(sectionsOf(replacement)))
    }).not.toThrow()

    expect(session.api().snapshot.dirtyFields).toEqual(['suggestions'])
  })
})

describe('StorySettingsSaveSessionProvider — leave guard', () => {
  // Electron queues a window close, then the user hits the back arrow before
  // answering. Holding one slot dropped the close, so the main process kept
  // holding a prevented close nobody could ever confirm.
  it('runs every queued leave intent, not just the newest', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({ children: sectionsOf(aids) })
    const closeWindow = vi.fn()
    const goBack = vi.fn()

    act(() => session.api().requestLeave(closeWindow))
    act(() => session.api().requestLeave(goBack))
    expect(session.api().pendingLeave).toBe(true)

    await act(async () => {
      session.api().resolveLeave('save')
    })

    expect(closeWindow).toHaveBeenCalledTimes(1)
    expect(goBack).toHaveBeenCalledTimes(1)
    expect(session.api().pendingLeave).toBe(false)
  })

  it('drops every queued intent on cancel, not just the newest', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({ children: sectionsOf(aids) })
    const closeWindow = vi.fn()
    const goBack = vi.fn()

    act(() => session.api().requestLeave(closeWindow))
    act(() => session.api().requestLeave(goBack))
    act(() => session.api().resolveLeave('cancel'))

    expect(session.api().pendingLeave).toBe(false)
    expect(closeWindow).not.toHaveBeenCalled()
    expect(goBack).not.toHaveBeenCalled()

    // A later save must not resurrect them.
    await act(async () => {
      await session.api().save()
    })
    expect(closeWindow).not.toHaveBeenCalled()
    expect(goBack).not.toHaveBeenCalled()
  })

  // A window-close intercept can reach resolveLeave without going through the
  // dialog; requestLeave first is the precondition, not an optimization.
  it('does nothing when resolved without a pending leave', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({ children: sectionsOf(aids) })

    await act(async () => {
      session.api().resolveLeave('save')
      session.api().resolveLeave('discard')
    })

    expect(session.onCommit).not.toHaveBeenCalled()
    expect(aids.reset).not.toHaveBeenCalled()
  })

  it('lets a clean session leave immediately', () => {
    const aids = makeSection('authoring-aids', 'generation', [])
    const session = mountSession({ children: sectionsOf(aids) })
    const proceed = vi.fn()

    act(() => session.api().requestLeave(proceed))

    expect(proceed).toHaveBeenCalledTimes(1)
    expect(session.api().pendingLeave).toBe(false)
  })

  it('holds a dirty session at the prompt', () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'])
    const session = mountSession({ children: sectionsOf(aids) })
    const proceed = vi.fn()

    act(() => session.api().requestLeave(proceed))

    expect(proceed).not.toHaveBeenCalled()
    expect(session.api().pendingLeave).toBe(true)
  })

  it('cancel keeps the session and stays put', () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({ children: sectionsOf(aids) })
    const proceed = vi.fn()

    act(() => session.api().requestLeave(proceed))
    act(() => session.api().resolveLeave('cancel'))

    expect(proceed).not.toHaveBeenCalled()
    expect(session.api().pendingLeave).toBe(false)
    expect(session.onCommit).not.toHaveBeenCalled()
    expect(aids.reset).not.toHaveBeenCalled()
  })

  it('discard throws the drafts away and proceeds', () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({ children: sectionsOf(aids) })
    const proceed = vi.fn()

    act(() => session.api().requestLeave(proceed))
    act(() => session.api().resolveLeave('discard'))

    expect(aids.reset).toHaveBeenCalledTimes(1)
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(session.onCommit).not.toHaveBeenCalled()
    expect(session.api().pendingLeave).toBe(false)
  })

  it('save commits once and then proceeds', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({ children: sectionsOf(aids) })
    const proceed = vi.fn()

    act(() => session.api().requestLeave(proceed))
    await act(async () => {
      session.api().resolveLeave('save')
    })

    expect(session.onCommit).toHaveBeenCalledExactlyOnceWith({ suggestionsEnabled: true })
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(session.api().pendingLeave).toBe(false)
  })

  it('does NOT proceed when the save it was asked for fails', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({
      children: sectionsOf(aids),
      onCommit: vi.fn(() => Promise.reject(new Error('write failed'))),
    })
    const proceed = vi.fn()

    act(() => session.api().requestLeave(proceed))
    await act(async () => {
      session.api().resolveLeave('save')
    })

    expect(session.onSaveFailed).toHaveBeenCalledTimes(1)
    expect(proceed).not.toHaveBeenCalled()
    expect(aids.reset).not.toHaveBeenCalled()
    // The guard stays up so the failure leaves the user on the same choice
    // instead of stranding the navigation they asked for.
    expect(session.api().pendingLeave).toBe(true)
  })

  it('holds the guard open and saving while its own save is in flight', async () => {
    const releases: (() => void)[] = []
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({
      children: sectionsOf(aids),
      onCommit: vi.fn(() => new Promise<void>((resolve) => releases.push(resolve))),
    })
    const proceed = vi.fn()

    act(() => session.api().requestLeave(proceed))
    await act(async () => {
      session.api().resolveLeave('save')
    })

    expect(session.api().pendingLeave).toBe(true)
    expect(session.api().saving).toBe(true)
    expect(proceed).not.toHaveBeenCalled()

    await act(async () => {
      for (const release of releases) release()
    })

    expect(session.api().pendingLeave).toBe(false)
    expect(session.api().saving).toBe(false)
    expect(proceed).toHaveBeenCalledTimes(1)
  })

  // The SaveBar and the header back arrow both stay live during a commit, so a
  // leave can be requested after the save that will satisfy it already started.
  it('honours a leave requested while an earlier save was already running', async () => {
    const releases: (() => void)[] = []
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({
      children: sectionsOf(aids),
      onCommit: vi.fn(() => new Promise<void>((resolve) => releases.push(resolve))),
    })
    const proceed = vi.fn()

    await act(async () => {
      void session.api().save()
    })
    expect(session.api().saving).toBe(true)

    act(() => session.api().requestLeave(proceed))
    expect(session.api().pendingLeave).toBe(true)

    await act(async () => {
      for (const release of releases) release()
    })

    expect(proceed).toHaveBeenCalledTimes(1)
    expect(session.api().pendingLeave).toBe(false)
  })

  it('does not navigate on a save once the pending leave was cancelled', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({ children: sectionsOf(aids) })
    const proceed = vi.fn()

    act(() => session.api().requestLeave(proceed))
    act(() => session.api().resolveLeave('cancel'))

    await act(async () => {
      await session.api().save()
    })

    expect(proceed).not.toHaveBeenCalled()
    expect(session.api().pendingLeave).toBe(false)
  })

  // The in-flight refusal below reads the same ref that gates save() re-entry,
  // so a flag left raised would silently make every later leave inert.
  it('accepts a save-and-leave after an earlier commit has settled', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({ children: sectionsOf(aids) })

    await act(async () => {
      await session.api().save()
    })

    const proceed = vi.fn()
    act(() => session.api().requestLeave(proceed))
    await act(async () => {
      session.api().resolveLeave('save')
    })

    expect(session.onCommit).toHaveBeenCalledTimes(2)
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(session.api().pendingLeave).toBe(false)
  })

  // The dialog disables itself mid-commit, but window-close and other non-modal
  // intercepts reach resolveLeave directly, so the refusal lives here too.
  it('refuses a cancel that arrives while its own save is in flight', async () => {
    const releases: (() => void)[] = []
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({
      children: sectionsOf(aids),
      onCommit: vi.fn(() => new Promise<void>((resolve) => releases.push(resolve))),
    })
    const proceed = vi.fn()

    act(() => session.api().requestLeave(proceed))
    await act(async () => {
      session.api().resolveLeave('save')
    })
    await act(async () => {
      session.api().resolveLeave('cancel')
    })

    expect(session.api().pendingLeave).toBe(true)

    await act(async () => {
      for (const release of releases) release()
    })

    // Refused, not queued: the save the user asked for still lands and leaves.
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(session.api().pendingLeave).toBe(false)
  })

  it('refuses a discard that arrives while its own save is in flight', async () => {
    const releases: (() => void)[] = []
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({
      children: sectionsOf(aids),
      onCommit: vi.fn(() => new Promise<void>((resolve) => releases.push(resolve))),
    })
    const proceed = vi.fn()

    act(() => session.api().requestLeave(proceed))
    await act(async () => {
      session.api().resolveLeave('save')
    })
    await act(async () => {
      session.api().resolveLeave('discard')
    })

    expect(aids.reset).not.toHaveBeenCalled()
    expect(proceed).not.toHaveBeenCalled()
    expect(session.api().pendingLeave).toBe(true)

    await act(async () => {
      for (const release of releases) release()
    })

    expect(aids.reset).toHaveBeenCalledTimes(1)
    expect(proceed).toHaveBeenCalledTimes(1)
  })

  // The SaveBar's Discard button is `disabled={saving}`, but that is
  // presentation: the write lands regardless, so a discard let through here
  // would revert the drafts and leave the session clean showing the values the
  // user asked to throw away, under a "Saved." toast.
  it('refuses a bare discard that arrives while a save is in flight', async () => {
    const releases: (() => void)[] = []
    const aids = makeSection('authoring-aids', 'generation', ['suggestions'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({
      children: sectionsOf(aids),
      onCommit: vi.fn(() => new Promise<void>((resolve) => releases.push(resolve))),
    })

    await act(async () => {
      void session.api().save()
    })
    act(() => session.api().discard())

    expect(aids.reset).not.toHaveBeenCalled()

    await act(async () => {
      for (const release of releases) release()
    })

    expect(session.onCommit).toHaveBeenCalledExactlyOnceWith({ suggestionsEnabled: true })
  })
})

describe('useStorySettingsSection', () => {
  it('throws outside a provider', () => {
    const aids = makeSection('authoring-aids', 'generation', [])
    expect(() => render(<Section fixture={aids} />)).toThrow(
      /must be used inside StorySettingsSaveSessionProvider/,
    )
  })

  it('settles instead of looping when a section republishes a fresh array', async () => {
    const renders = { count: 0 }
    const ChurningSection = churningSection(renders)

    const session = mountSession({ children: <ChurningSection /> })

    const settled = renders.count
    expect(settled).toBeLessThanOrEqual(3)
    expect(session.api().snapshot.dirtyFields).toHaveLength(2)

    await act(async () => {})
    expect(renders.count).toBe(settled)

    act(() => {
      session.rerenderWith(<ChurningSection />)
    })
    expect(renders.count).toBe(settled + 1)
  })

  it('settles on the dirty key alone when array identity no longer guards', () => {
    guard.breakArrayIdentity = true
    const renders = { count: 0 }
    const ChurningSection = churningSection(renders)

    const session = mountSession({ children: <ChurningSection /> })

    expect(renders.count).toBeLessThanOrEqual(3)
    expect(session.api().snapshot.dirtyFields).toHaveLength(2)
  })
})

describe('StorySettingsSaveSessionProvider — validity', () => {
  it('refuses the save while a dirty section is invalid, without calling onCommit', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestion categories'])
    const invalid: SectionFixture = { ...aids, invalidReason: 'dup' }
    const session = mountSession({ children: sectionsOf(invalid) })

    let outcome: SaveOutcome | undefined
    await act(async () => {
      outcome = await session.api().save()
    })

    expect(outcome).toEqual({ status: 'invalid', reason: 'dup' })
    expect(session.onCommit).not.toHaveBeenCalled()
    expect(aids.reset).not.toHaveBeenCalled()
  })

  it('leaves a pending leave open when the save is refused as invalid', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestion categories'])
    const invalid: SectionFixture = { ...aids, invalidReason: 'dup' }
    const session = mountSession({ children: sectionsOf(invalid) })
    const proceed = vi.fn()

    act(() => session.api().requestLeave(proceed))
    await act(async () => {
      session.api().resolveLeave('save')
    })

    expect(proceed).not.toHaveBeenCalled()
    expect(session.api().pendingLeave).toBe(true)
  })

  it('commits normally once the section reports itself valid again', async () => {
    const aids = makeSection('authoring-aids', 'generation', ['suggestion categories'], {
      suggestionsEnabled: true,
    })
    const session = mountSession({ children: sectionsOf(aids) })

    await act(async () => {
      await session.api().save()
    })

    expect(session.onCommit).toHaveBeenCalledTimes(1)
  })
})
