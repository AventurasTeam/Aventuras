import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RetryService, type RetryBackupData, type RetryStoreCallbacks } from './RetryService'

function makeBackup(overrides: Partial<RetryBackupData> = {}): RetryBackupData {
  return {
    storyId: 'story-1',
    branchId: 'branch-a',
    timestamp: 1,
    entries: [],
    characters: [],
    locations: [],
    items: [],
    storyBeats: [],
    userActionContent: 'I open the door',
    rawInput: 'open the door',
    actionType: 'do',
    wasRawActionChoice: false,
    activationData: {},
    storyPosition: 0,
    entryCountBeforeAction: 12,
    hasFullState: true,
    hasEntityIds: true,
    characterIds: [],
    locationIds: [],
    itemIds: [],
    storyBeatIds: [],
    timeTracker: null,
    ...overrides,
  }
}

function makeCallbacks() {
  return {
    restoreFromRetryBackup: vi.fn(async () => {}),
    deleteEntriesFromPosition: vi.fn(async () => {}),
    deleteEntitiesCreatedAfterBackup: vi.fn(async () => {}),
    restoreCharacterSnapshots: vi.fn(async () => {}),
    restoreTimeTrackerSnapshot: vi.fn(async () => {}),
    assertEntriesRemovable: vi.fn(() => {}),
    lockRetryInProgress: vi.fn(() => {}),
    unlockRetryInProgress: vi.fn(() => {}),
    restoreActivationData: vi.fn(() => {}),
    clearActivationData: vi.fn(() => {}),
    setLastLorebookRetrieval: vi.fn(() => {}),
  } satisfies RetryStoreCallbacks
}

const uiCleanup = () => ({
  clearGenerationError: vi.fn(),
  clearSuggestions: vi.fn(),
  clearActionChoices: vi.fn(),
})

/** Every callback that changes stored state. None may run when a restore is refused. */
function mutatingCalls(callbacks: ReturnType<typeof makeCallbacks>) {
  return [
    callbacks.restoreFromRetryBackup,
    callbacks.deleteEntriesFromPosition,
    callbacks.deleteEntitiesCreatedAfterBackup,
    callbacks.restoreCharacterSnapshots,
    callbacks.restoreTimeTrackerSnapshot,
    callbacks.restoreActivationData,
    callbacks.clearActivationData,
  ]
}

describe('RetryService branch enforcement', () => {
  let service: RetryService
  let callbacks: ReturnType<typeof makeCallbacks>

  beforeEach(() => {
    service = new RetryService()
    callbacks = makeCallbacks()
  })

  describe('restoreFromBackup, entered directly', () => {
    it('refuses a snapshot from another branch without touching state', async () => {
      const result = await service.restoreFromBackup(makeBackup(), callbacks, 'branch-b')

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/another branch/i)
      for (const call of mutatingCalls(callbacks)) expect(call).not.toHaveBeenCalled()
    })

    it('proceeds on a matching branch', async () => {
      const result = await service.restoreFromBackup(makeBackup(), callbacks, 'branch-a')

      expect(result.success).toBe(true)
      expect(callbacks.restoreFromRetryBackup).toHaveBeenCalledTimes(1)
    })

    it('refuses the ID-based path from another branch too', async () => {
      const backup = makeBackup({ hasFullState: false })

      const result = await service.restoreFromBackup(backup, callbacks, 'branch-b')

      expect(result.success).toBe(false)
      expect(callbacks.deleteEntriesFromPosition).not.toHaveBeenCalled()
      expect(callbacks.deleteEntitiesCreatedAfterBackup).not.toHaveBeenCalled()
      expect(callbacks.lockRetryInProgress).not.toHaveBeenCalled()
    })

    it('proceeds on the ID-based path when the branch matches', async () => {
      const backup = makeBackup({ hasFullState: false })

      const result = await service.restoreFromBackup(backup, callbacks, 'branch-a')

      expect(result.success).toBe(true)
      expect(callbacks.deleteEntriesFromPosition).toHaveBeenCalledWith(12)
    })

    it('passes the snapshot branch to the store so it can backstop the check', async () => {
      await service.restoreFromBackup(makeBackup(), callbacks, 'branch-a')

      expect(callbacks.restoreFromRetryBackup).toHaveBeenCalledWith(
        expect.objectContaining({ branchId: 'branch-a' }),
      )
    })
  })

  describe('main branch is not conflated with a named branch', () => {
    it('refuses a main-branch snapshot while a named branch is active', async () => {
      const result = await service.restoreFromBackup(
        makeBackup({ branchId: null }),
        callbacks,
        'branch-a',
      )

      expect(result.success).toBe(false)
      for (const call of mutatingCalls(callbacks)) expect(call).not.toHaveBeenCalled()
    })

    it('refuses a named-branch snapshot while main is active', async () => {
      const result = await service.restoreFromBackup(makeBackup(), callbacks, null)

      expect(result.success).toBe(false)
      for (const call of mutatingCalls(callbacks)) expect(call).not.toHaveBeenCalled()
    })

    it('proceeds when both are main', async () => {
      const result = await service.restoreFromBackup(
        makeBackup({ branchId: null }),
        callbacks,
        null,
      )

      expect(result.success).toBe(true)
    })
  })

  describe('handleRetryLastMessage', () => {
    it('refuses before the preflight touches anything', async () => {
      const cleanup = uiCleanup()

      const result = await service.handleRetryLastMessage(
        makeBackup(),
        callbacks,
        cleanup,
        'branch-b',
      )

      expect(result.success).toBe(false)
      expect(callbacks.assertEntriesRemovable).not.toHaveBeenCalled()
      expect(callbacks.setLastLorebookRetrieval).not.toHaveBeenCalled()
      expect(cleanup.clearSuggestions).not.toHaveBeenCalled()
      for (const call of mutatingCalls(callbacks)) expect(call).not.toHaveBeenCalled()
    })

    it('proceeds on a matching branch', async () => {
      const result = await service.handleRetryLastMessage(
        makeBackup(),
        callbacks,
        uiCleanup(),
        'branch-a',
      )

      expect(result.success).toBe(true)
      expect(callbacks.restoreFromRetryBackup).toHaveBeenCalledTimes(1)
    })
  })

  describe('handleStopGeneration', () => {
    it('refuses a snapshot from another branch and leaves the active branch alone', async () => {
      const cleanup = uiCleanup()

      const result = await service.handleStopGeneration(
        makeBackup(),
        callbacks,
        cleanup,
        'branch-b',
      )

      expect(result.success).toBe(false)
      expect(cleanup.clearGenerationError).not.toHaveBeenCalled()
      for (const call of mutatingCalls(callbacks)) expect(call).not.toHaveBeenCalled()
    })

    it('proceeds on a matching branch', async () => {
      const result = await service.handleStopGeneration(
        makeBackup(),
        callbacks,
        uiCleanup(),
        'branch-a',
      )

      expect(result.success).toBe(true)
    })
  })

  it('still refuses on a branch mismatch when the entries are otherwise removable', async () => {
    callbacks.assertEntriesRemovable = vi.fn(() => {
      throw new Error('should not be consulted')
    })

    const result = await service.handleRetryLastMessage(
      makeBackup(),
      callbacks,
      uiCleanup(),
      'branch-b',
    )

    expect(result.error).toMatch(/another branch/i)
  })
})
