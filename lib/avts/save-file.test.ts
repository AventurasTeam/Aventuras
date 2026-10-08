// @vitest-environment jsdom
// jsdom supplies `document` and `HTMLAnchorElement`; the tests stub URL.createObjectURL and revokeObjectURL.
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import type { AvtsFile } from './envelope'
import { saveAvtsFile } from './save-file'

const FILE: AvtsFile = {
  fileName: 'character-kael.avts',
  contents: '{"format":"aventuras-entity"}',
}

let createObjectURL: Mock<(blob: Blob) => string>
let revokeObjectURL: Mock<(url: string) => void>

const URL_STATICS = {
  createObjectURL: Object.getOwnPropertyDescriptor(URL, 'createObjectURL'),
  revokeObjectURL: Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL'),
}

beforeEach(() => {
  createObjectURL = vi.fn((_blob: Blob) => 'blob:avts-1')
  revokeObjectURL = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectURL,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revokeObjectURL,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const [name, descriptor] of Object.entries(URL_STATICS)) {
    // jsdom's URL inherits some statics; deleting the stub re-exposes the inherited one.
    if (descriptor == null) Reflect.deleteProperty(URL, name)
    else Object.defineProperty(URL, name, descriptor)
  }
})

describe('saveAvtsFile (web)', () => {
  it('downloads the contents as JSON through a detached anchor named after the file', async () => {
    const clicks: { href: string; download: string }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.href, download: this.download })
    })
    await saveAvtsFile(FILE)
    expect(clicks).toEqual([{ href: 'blob:avts-1', download: 'character-kael.avts' }])
    const blob = createObjectURL.mock.calls[0]?.[0]
    expect(blob?.type).toBe('application/json')
    expect(await blob?.text()).toBe(FILE.contents)
    expect(document.querySelector('a')).toBeNull()
  })

  it('revokes the blob URL on a later turn, never before the click returns', async () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await saveAvtsFile(FILE)
    expect(revokeObjectURL).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:avts-1')
  })

  it('rejects when the browser refuses the blob, without clicking', async () => {
    createObjectURL.mockImplementation(() => {
      throw new Error('blob refused')
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await expect(saveAvtsFile(FILE)).rejects.toThrow('blob refused')
    expect(click).not.toHaveBeenCalled()
  })
})
