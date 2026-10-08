import { beforeEach, describe, expect, it, vi } from 'vitest'

// Separate from save-file.test.ts: eslint resolves `./save-file` and `./save-file.native`
// to one module, so import/no-duplicates would merge an import of both into the web one.
import { saveAvtsFile } from './save-file.native'

const harness = vi.hoisted(() => ({
  calls: [] as string[],
  shareOptions: undefined as unknown,
  available: true,
  shareError: undefined as Error | undefined,
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

vi.mock('expo-sharing', () => ({
  isAvailableAsync: () => Promise.resolve(harness.available),
  shareAsync: (url: string, options: unknown) => {
    harness.calls.push(`share ${url}`)
    harness.shareOptions = options
    return harness.shareError == null ? Promise.resolve() : Promise.reject(harness.shareError)
  },
}))

const FILE = { fileName: 'character-kael.avts', contents: '{"format":"aventuras-entity"}' }

beforeEach(() => {
  harness.calls.length = 0
  harness.shareOptions = undefined
  harness.available = true
  harness.shareError = undefined
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
