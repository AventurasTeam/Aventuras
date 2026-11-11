import { describe, it, expect } from 'vitest'
import type { EmbeddedImageStatus } from '#lib/types/index.ts'
import { diffGalleryImages, isImageInProgress } from './galleryImages'

const row = (id: string, status: EmbeddedImageStatus) => ({ id, status })

describe('isImageInProgress', () => {
  it('is true only while the pixels are still being produced', () => {
    expect(isImageInProgress(row('a', 'pending'))).toBe(true)
    expect(isImageInProgress(row('a', 'generating'))).toBe(true)
    expect(isImageInProgress(row('a', 'complete'))).toBe(false)
    expect(isImageInProgress(row('a', 'failed'))).toBe(false)
  })
})

describe('diffGalleryImages', () => {
  it('reports nothing for an identical list', () => {
    const list = [row('a', 'complete'), row('b', 'failed')]
    expect(diffGalleryImages(list, list)).toEqual({ removed: [], statusChanged: [] })
  })

  it('reports rows that disappeared', () => {
    const previous = [row('a', 'complete'), row('b', 'complete'), row('c', 'complete')]
    const next = [row('b', 'complete')]
    expect(diffGalleryImages(previous, next).removed).toEqual(['a', 'c'])
  })

  it('reports rows whose status changed, and not rows that merely appeared', () => {
    const previous = [row('a', 'generating'), row('b', 'complete')]
    const next = [row('a', 'complete'), row('b', 'complete'), row('new', 'pending')]
    expect(diffGalleryImages(previous, next)).toEqual({ removed: [], statusChanged: ['a'] })
  })

  it('treats a regenerated row that went complete to complete as unchanged', () => {
    const list = [row('a', 'complete')]
    expect(diffGalleryImages(list, [row('a', 'complete')]).statusChanged).toEqual([])
  })

  it('handles an empty previous list', () => {
    expect(diffGalleryImages([], [row('a', 'complete')])).toEqual({
      removed: [],
      statusChanged: [],
    })
  })
})
