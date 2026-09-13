import { beforeEach, describe, expect, it, vi } from 'vitest'

const sync = {
  exportStoryToJson: vi.fn(),
  pushStory: vi.fn(),
  deleteStory: vi.fn(),
}
const importFromContent = vi.fn()

vi.mock('./sync', () => ({ syncService: sync }))
vi.mock('./export', () => ({ exportService: { importFromContent } }))

const { importSyncedStory, pushSyncedStory } = await import('./syncActions')

const connection = { ip: '192.0.2.1', port: 4321, token: 'token' }
const packBinding = { packId: 'pack-1', customVariableValues: {} }

beforeEach(() => {
  vi.clearAllMocks()
  sync.exportStoryToJson.mockResolvedValue('{"story":{"id":"story-1"}}')
  sync.pushStory.mockResolvedValue(undefined)
  sync.deleteStory.mockResolvedValue(undefined)
  importFromContent.mockResolvedValue({ success: true, storyId: 'imported-story' })
})

describe('pushSyncedStory', () => {
  it('exports and pushes the story without a checkpoint mutation', async () => {
    await pushSyncedStory(connection, 'story-1')

    expect(sync.exportStoryToJson).toHaveBeenCalledWith('story-1')
    expect(sync.pushStory).toHaveBeenCalledWith(connection, '{"story":{"id":"story-1"}}')
  })
})

describe('importSyncedStory', () => {
  it('deletes the replaced story and imports the payload without a checkpoint mutation', async () => {
    const result = await importSyncedStory('{"story":{"id":"remote"}}', 'local-story', packBinding)

    expect(sync.deleteStory).toHaveBeenCalledWith('local-story')
    expect(importFromContent).toHaveBeenCalledWith(
      '{"story":{"id":"remote"}}',
      true,
      expect.objectContaining({ resolvePackBinding: expect.any(Function) }),
    )
    const options = importFromContent.mock.calls[0][2]
    await expect(options.resolvePackBinding()).resolves.toBe(packBinding)
    expect(result).toEqual({ success: true, storyId: 'imported-story' })
  })
})
