import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AvtsFile } from './envelope'
// Separate from save-file.test.ts: eslint resolves `./save-file` and `./save-file.native`
// to one module, so import/no-duplicates would merge an import of both into the web one.
import type { saveAvtsFile as SaveAvtsFile } from './save-file.native'

const harness = vi.hoisted(() => ({
  calls: [] as string[],
  shareOptions: undefined as unknown,
  available: true as boolean | Promise<boolean>,
  availabilityChecks: 0,
  shareError: undefined as Error | undefined,
  heldShare: undefined as PromiseWithResolvers<void> | undefined,
}))

vi.mock('expo-file-system', () => {
  class File {
    readonly uri: string
    constructor(directory: { uri: string }, name: string) {
      this.uri = `${directory.uri}/${name}`
    }
    create(options?: { overwrite?: boolean }) {
      harness.calls.push(`create ${this.uri} overwrite=${String(options?.overwrite)}`)
    }
    write(content: string) {
      harness.calls.push(`write ${this.uri} ${content}`)
    }
  }
  return { File, Paths: { cache: { uri: 'file:///cache' } } }
})

const sharingMock = vi.hoisted(() => () => ({
  isAvailableAsync: () => {
    harness.availabilityChecks += 1
    return Promise.resolve(harness.available)
  },
  shareAsync: (url: string, options: unknown) => {
    harness.calls.push(`share ${url}`)
    harness.shareOptions = options
    if (harness.heldShare != null) return harness.heldShare.promise
    return harness.shareError == null ? Promise.resolve() : Promise.reject(harness.shareError)
  },
}))

vi.mock('expo-sharing', sharingMock)

const FILE: AvtsFile = {
  fileName: 'character-kael.avts',
  contents: '{"format":"aventuras-entity"}',
}

const SHARE = 'share file:///cache/character-kael.avts'

function holdShare(): PromiseWithResolvers<void> {
  harness.heldShare = Promise.withResolvers<void>()
  return harness.heldShare
}

const nextTurn = () => new Promise((resolve) => setTimeout(resolve, 0))

let saveAvtsFile: typeof SaveAvtsFile

beforeEach(async () => {
  harness.calls.length = 0
  harness.shareOptions = undefined
  harness.available = true
  harness.availabilityChecks = 0
  harness.shareError = undefined
  harness.heldShare = undefined
  // A fresh module per test: a share one test leaves pending would be joined by the next.
  vi.resetModules()
  ;({ saveAvtsFile } = await import('./save-file.native'))
})

afterEach(() => {
  // Restores the mock the module-missing case replaces; vi.doUnmock would load the real one.
  vi.doMock('expo-sharing', sharingMock)
})

describe('saveAvtsFile (native)', () => {
  it('writes the export under the cache directory, then shares that file', async () => {
    await saveAvtsFile(FILE)
    expect(harness.calls).toEqual([
      'create file:///cache/character-kael.avts overwrite=true',
      'write file:///cache/character-kael.avts {"format":"aventuras-entity"}',
      'share file:///cache/character-kael.avts',
    ])
    expect(harness.shareOptions).toEqual({
      mimeType: 'application/json',
      UTI: 'public.json',
      dialogTitle: 'character-kael.avts',
    })
  })

  it('rejects without writing a file when the platform cannot share', async () => {
    harness.available = false
    await expect(saveAvtsFile(FILE)).rejects.toThrow('sharing is not available')
    expect(harness.calls).toEqual([])
  })

  it('rejects when the share sheet fails', async () => {
    harness.shareError = new Error('share failed')
    await expect(saveAvtsFile(FILE)).rejects.toThrow('share failed')
  })

  it('joins a pending share instead of writing and sharing the file again', async () => {
    const availability = Promise.withResolvers<boolean>()
    harness.available = availability.promise
    const share = holdShare()
    const first = saveAvtsFile(FILE)
    await vi.waitFor(() => expect(harness.availabilityChecks).toBe(1))
    const beforeShare = saveAvtsFile(FILE)
    availability.resolve(true)
    await vi.waitFor(() => expect(harness.calls).toContain(SHARE))
    const duringShare = saveAvtsFile(FILE)
    let joinedSettled = false
    void Promise.allSettled([beforeShare, duringShare]).then(() => {
      joinedSettled = true
    })
    await nextTurn()
    expect(harness.availabilityChecks).toBe(1)
    expect(harness.calls).toEqual([
      'create file:///cache/character-kael.avts overwrite=true',
      'write file:///cache/character-kael.avts {"format":"aventuras-entity"}',
      SHARE,
    ])
    expect(joinedSettled).toBe(false)

    share.resolve()
    await Promise.all([first, beforeShare, duringShare])
  })

  it("rejects a joined call with the pending share's error", async () => {
    const share = holdShare()
    const first = saveAvtsFile(FILE)
    await vi.waitFor(() => expect(harness.calls).toContain(SHARE))
    const joined = saveAvtsFile(FILE)
    const error = new Error('share failed')
    share.reject(error)
    await expect(first).rejects.toBe(error)
    await expect(joined).rejects.toBe(error)
    expect(harness.calls.filter((call) => call === SHARE)).toHaveLength(1)
  })

  it.each(['resolved', 'rejected'] as const)(
    'shares again once the pending share has %s',
    async (outcome) => {
      const share = holdShare()
      const first = saveAvtsFile(FILE)
      await vi.waitFor(() => expect(harness.calls).toContain(SHARE))
      if (outcome === 'resolved') share.resolve()
      else share.reject(new Error('share failed'))
      await first.catch(() => {})
      harness.heldShare = undefined

      await saveAvtsFile(FILE)
      expect(harness.calls.filter((call) => call === SHARE)).toHaveLength(2)
    },
  )

  it('loads the module and fails only on export when the native module is missing', async () => {
    vi.resetModules()
    vi.doMock('expo-sharing', () => {
      throw new Error('Cannot find native module')
    })
    const { saveAvtsFile: saveWithoutNativeModule } = await import('./save-file.native')
    await expect(saveWithoutNativeModule(FILE)).rejects.toMatchObject({
      cause: { message: 'Cannot find native module' },
    })
    expect(harness.calls).toEqual([])
  })
})
