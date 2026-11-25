import { describe, it, expect } from 'vitest'
import {
  addImageOutput,
  isImageOutputFormat,
  moveImageOutput,
  parseImageOutputPreferences,
  pickImageOutput,
  removeImageOutput,
  setImageOutputCompression,
  takesCompression,
  type ImageOutputPreference,
} from './imageOutput'

const all = { outputFormats: ['png', 'jpeg', 'webp'] as const }
const withCompression = {
  outputFormats: ['png', 'jpeg', 'webp'] as const,
  compressionFormats: ['jpeg', 'webp'] as const,
}

describe('isImageOutputFormat / takesCompression', () => {
  it('knows the three formats and drops the rest', () => {
    expect(['png', 'jpeg', 'webp'].every(isImageOutputFormat)).toBe(true)
    expect(isImageOutputFormat('svg')).toBe(false)
    expect(isImageOutputFormat('gif')).toBe(false)
    expect(isImageOutputFormat('jpg')).toBe(false)
  })

  it('gives compression to the lossy formats only', () => {
    expect(takesCompression('png')).toBe(false)
    expect(takesCompression('jpeg')).toBe(true)
    expect(takesCompression('webp')).toBe(true)
  })
})

describe('pickImageOutput', () => {
  const prefs: ImageOutputPreference[] = [
    { format: 'webp', compression: 80 },
    { format: 'jpeg', compression: 90 },
  ]

  it('takes the first preference the model accepts', () => {
    expect(pickImageOutput(prefs, withCompression)).toEqual({ format: 'webp', compression: 80 })
    expect(pickImageOutput(prefs, { ...withCompression, outputFormats: ['png', 'jpeg'] })).toEqual({
      format: 'jpeg',
      compression: 90,
    })
  })

  it('sends nothing when no preference is accepted', () => {
    expect(pickImageOutput(prefs, { outputFormats: ['png'] })).toBeUndefined()
  })

  it('sends nothing for an empty list or unknown capabilities', () => {
    expect(pickImageOutput([], all)).toBeUndefined()
    expect(pickImageOutput(prefs, undefined)).toBeUndefined()
    expect(pickImageOutput(prefs, {})).toBeUndefined()
    expect(pickImageOutput(prefs, { outputFormats: [] })).toBeUndefined()
  })

  it('keeps compression only for a format the model lists as taking it', () => {
    expect(pickImageOutput(prefs, all)).toEqual({ format: 'webp' })
    expect(pickImageOutput(prefs, { ...all, compressionFormats: ['jpeg'] })).toEqual({
      format: 'webp',
    })
  })

  it('sends no compression when the preference set none', () => {
    expect(pickImageOutput([{ format: 'jpeg' }], withCompression)).toEqual({ format: 'jpeg' })
  })

  it('never sends compression with png', () => {
    expect(
      pickImageOutput([{ format: 'png', compression: 50 }], {
        ...all,
        compressionFormats: ['png', 'jpeg'],
      }),
    ).toEqual({ format: 'png' })
  })

  it('keeps a compression of zero', () => {
    expect(pickImageOutput([{ format: 'jpeg', compression: 0 }], withCompression)).toEqual({
      format: 'jpeg',
      compression: 0,
    })
  })
})

describe('parseImageOutputPreferences', () => {
  it('returns an empty list for anything that is not an array', () => {
    for (const value of [undefined, null, 'png', 3, {}]) {
      expect(parseImageOutputPreferences(value)).toEqual([])
    }
  })

  it('drops unknown formats and non-objects', () => {
    expect(
      parseImageOutputPreferences([
        { format: 'gif' },
        'png',
        null,
        { format: 4 },
        {},
        { format: 'webp' },
      ]),
    ).toEqual([{ format: 'webp' }])
  })

  it('keeps the first of a repeated format', () => {
    expect(
      parseImageOutputPreferences([
        { format: 'jpeg', compression: 70 },
        { format: 'webp' },
        { format: 'jpeg', compression: 10 },
      ]),
    ).toEqual([{ format: 'jpeg', compression: 70 }, { format: 'webp' }])
  })

  it('rounds and clamps compression, and drops one that is not a number', () => {
    expect(
      parseImageOutputPreferences([
        { format: 'jpeg', compression: 72.6 },
        { format: 'webp', compression: 400 },
      ]),
    ).toEqual([
      { format: 'jpeg', compression: 73 },
      { format: 'webp', compression: 100 },
    ])
    expect(parseImageOutputPreferences([{ format: 'jpeg', compression: -5 }])).toEqual([
      { format: 'jpeg', compression: 0 },
    ])
    expect(parseImageOutputPreferences([{ format: 'jpeg', compression: '80' }])).toEqual([
      { format: 'jpeg' },
    ])
    expect(parseImageOutputPreferences([{ format: 'jpeg', compression: NaN }])).toEqual([
      { format: 'jpeg' },
    ])
  })

  it('drops compression from png', () => {
    expect(parseImageOutputPreferences([{ format: 'png', compression: 50 }])).toEqual([
      { format: 'png' },
    ])
  })

  it('is idempotent', () => {
    const once = parseImageOutputPreferences([
      { format: 'webp', compression: 150 },
      { format: 'png', compression: 5 },
      { format: 'webp' },
    ])
    expect(parseImageOutputPreferences(once)).toEqual(once)
  })
})

describe('list edits', () => {
  const list: ImageOutputPreference[] = [{ format: 'webp', compression: 80 }, { format: 'jpeg' }]

  it('adds a format once, at the end', () => {
    expect(addImageOutput(list, 'png')).toEqual([...list, { format: 'png' }])
    expect(addImageOutput(list, 'jpeg')).toEqual(list)
  })

  it('removes by index without touching the input', () => {
    expect(removeImageOutput(list, 0)).toEqual([{ format: 'jpeg' }])
    expect(list).toHaveLength(2)
  })

  it('swaps with the neighbour', () => {
    expect(moveImageOutput(list, 0, 1)).toEqual([
      { format: 'jpeg' },
      { format: 'webp', compression: 80 },
    ])
    expect(moveImageOutput(list, 1, -1)).toEqual([
      { format: 'jpeg' },
      { format: 'webp', compression: 80 },
    ])
  })

  it('leaves an entry at the edge where it is', () => {
    expect(moveImageOutput(list, 0, -1)).toEqual(list)
    expect(moveImageOutput(list, 1, 1)).toEqual(list)
  })

  it('sets and clears compression on a lossy entry', () => {
    expect(setImageOutputCompression(list, 1, 60)).toEqual([
      { format: 'webp', compression: 80 },
      { format: 'jpeg', compression: 60 },
    ])
    expect(setImageOutputCompression(list, 0, undefined)).toEqual([
      { format: 'webp' },
      { format: 'jpeg' },
    ])
  })

  it('clamps a typed compression', () => {
    expect(setImageOutputCompression(list, 1, 250)).toEqual([
      { format: 'webp', compression: 80 },
      { format: 'jpeg', compression: 100 },
    ])
  })

  it('ignores compression on png and a missing index', () => {
    const withPng: ImageOutputPreference[] = [{ format: 'png' }]
    expect(setImageOutputCompression(withPng, 0, 50)).toEqual(withPng)
    expect(setImageOutputCompression(list, 9, 50)).toEqual(list)
  })
})
