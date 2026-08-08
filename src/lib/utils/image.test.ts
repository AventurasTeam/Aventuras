import { describe, it, expect } from 'vitest'
import {
  parseImageSpec,
  specFromPixels,
  specToPixels,
  specToAspectRatio,
  specToRatioString,
  expectedPixels,
  normalizeImageDataUrl,
  IMAGE_ORIENTATIONS,
  IMAGE_SIZE_TIERS,
} from './image'

describe('specToPixels', () => {
  it('matches the orientation it was asked for', () => {
    for (const size of IMAGE_SIZE_TIERS) {
      const landscape = specToPixels({ orientation: 'landscape', size })
      expect(landscape.width).toBeGreaterThan(landscape.height)

      const portrait = specToPixels({ orientation: 'portrait', size })
      expect(portrait.height).toBeGreaterThan(portrait.width)

      const square = specToPixels({ orientation: 'square', size })
      expect(square.width).toBe(square.height)
    }
  })

  it('is exactly 16:9 for landscape and its mirror for portrait', () => {
    for (const size of IMAGE_SIZE_TIERS) {
      const { width, height } = specToPixels({ orientation: 'landscape', size })
      expect(width / height).toBeCloseTo(16 / 9, 5)
      expect(specToPixels({ orientation: 'portrait', size })).toEqual({
        width: height,
        height: width,
      })
    }
  })

  it('keeps every dimension on the 16px grid diffusion backends want', () => {
    for (const orientation of IMAGE_ORIENTATIONS) {
      for (const size of IMAGE_SIZE_TIERS) {
        const { width, height } = specToPixels({ orientation, size })
        expect(width % 16).toBe(0)
        expect(height % 16).toBe(0)
      }
    }
  })

  it('grows with the tier, at the same long edge for every orientation', () => {
    const edge = (spec: Parameters<typeof specToPixels>[0]) => {
      const { width, height } = specToPixels(spec)
      return Math.max(width, height)
    }
    for (const orientation of IMAGE_ORIENTATIONS) {
      expect(edge({ orientation, size: 'tiny' })).toBe(512)
      expect(edge({ orientation, size: 'small' })).toBe(1024)
      expect(edge({ orientation, size: 'medium' })).toBe(1536)
      expect(edge({ orientation, size: 'large' })).toBe(2048)
    }
  })

  it('returns a fresh object, so a caller cannot rewrite the table', () => {
    const first = specToPixels({ orientation: 'square', size: 'small' })
    first.width = 1
    expect(specToPixels({ orientation: 'square', size: 'small' }).width).toBe(1024)
  })
})

describe('parseImageSpec', () => {
  it('passes a spec through', () => {
    for (const orientation of IMAGE_ORIENTATIONS) {
      for (const size of IMAGE_SIZE_TIERS) {
        expect(parseImageSpec({ orientation, size })).toEqual({ orientation, size })
      }
    }
  })

  it('reads the legacy WIDTHxHEIGHT strings back as the intent they approximated', () => {
    // The shipped defaults, which must keep resolving to the same pixels.
    expect(specToPixels(parseImageSpec('1024x1024'))).toEqual({ width: 1024, height: 1024 })
    expect(specToPixels(parseImageSpec('512x512'))).toEqual({ width: 512, height: 512 })
    expect(parseImageSpec('1280x720')).toEqual({ orientation: 'landscape', size: 'small' })
    expect(parseImageSpec('720x1280')).toEqual({ orientation: 'portrait', size: 'small' })
    expect(parseImageSpec('2048x2048')).toEqual({ orientation: 'square', size: 'large' })
  })

  it('accepts the × the old size badge rendered', () => {
    expect(parseImageSpec('1536 × 1024')).toEqual({ orientation: 'landscape', size: 'medium' })
  })

  it('falls back to the default on anything it cannot read', () => {
    const fallback = { orientation: 'square', size: 'small' }
    expect(parseImageSpec(null)).toEqual(fallback)
    expect(parseImageSpec('')).toEqual(fallback)
    expect(parseImageSpec('huge')).toEqual(fallback)
    expect(parseImageSpec('0x0')).toEqual(fallback)
  })

  it('falls back on scalars that are not sizes at all', () => {
    // The signature says `unknown` because the input is settings JSON: nothing writes a
    // number or a boolean here today, but the load path must not throw if one is there.
    const fallback = { orientation: 'square', size: 'small' }
    expect(parseImageSpec(1024)).toEqual(fallback)
    expect(parseImageSpec(true)).toEqual(fallback)
    expect(parseImageSpec(['1024x1024'])).toEqual(fallback)
  })

  it('repairs a spec carrying values outside the unions, which disk can hold', () => {
    expect(parseImageSpec({ orientation: 'diagonal', size: 'gigantic' } as never)).toEqual({
      orientation: 'square',
      size: 'small',
    })
  })

  it('never hands out the same default object twice', () => {
    parseImageSpec(null).orientation = 'portrait'
    expect(parseImageSpec(null).orientation).toBe('square')
  })
})

describe('specFromPixels', () => {
  it('reads a slightly-off ratio as the orientation it leans to', () => {
    expect(specFromPixels(1920, 1088).orientation).toBe('landscape')
    expect(specFromPixels(1024, 1020).orientation).toBe('square')
  })

  it('classifies by the longest edge, so orientation does not shift the tier', () => {
    expect(specFromPixels(1536, 864).size).toBe(specFromPixels(864, 1536).size)
  })
})

describe('specToAspectRatio', () => {
  const SUPPORTED = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']

  it('uses the canonical ratio when the provider lists it', () => {
    expect(specToAspectRatio({ orientation: 'landscape', size: 'medium' }, SUPPORTED)).toBe('16:9')
    expect(specToAspectRatio({ orientation: 'portrait', size: 'medium' }, SUPPORTED)).toBe('9:16')
    expect(specToAspectRatio({ orientation: 'square', size: 'medium' }, SUPPORTED)).toBe('1:1')
  })

  it('falls back to the nearest shape, never to a square', () => {
    const noWide = ['1:1', '4:3', '3:4']
    expect(specToAspectRatio({ orientation: 'landscape', size: 'large' }, noWide)).toBe('4:3')
    expect(specToAspectRatio({ orientation: 'portrait', size: 'large' }, noWide)).toBe('3:4')
  })

  it('compares in log space, so a portrait request cannot land on a square', () => {
    // Linearly, 1:1 is 0.44 away from 9:16 and 1:2 is 0.06 — but the scale is lopsided.
    const options = ['1:1', '1:2', '3:2']
    expect(specToAspectRatio({ orientation: 'portrait', size: 'medium' }, options)).toBe('1:2')
  })

  it('returns a well-formed ratio when the provider lists nothing usable', () => {
    expect(specToAspectRatio({ orientation: 'landscape', size: 'medium' }, [])).toBe('16:9')
    expect(specToAspectRatio({ orientation: 'landscape', size: 'medium' }, ['auto'])).toBe('16:9')
  })

  it('agrees with the pixel table on what each orientation means', () => {
    for (const orientation of IMAGE_ORIENTATIONS) {
      const spec = { orientation, size: 'medium' as const }
      const { width, height } = specToPixels(spec)
      const [w, h] = specToRatioString(spec).split(':').map(Number)
      expect(width / height).toBeCloseTo(w / h, 5)
    }
  })
})

describe('expectedPixels', () => {
  it('resolves a stored value straight to placeholder dimensions', () => {
    expect(expectedPixels({ orientation: 'landscape', size: 'large' })).toEqual({
      width: 2048,
      height: 1152,
    })
    expect(expectedPixels('1024x1024')).toEqual({ width: 1024, height: 1024 })
  })
})

describe('normalizeImageDataUrl', () => {
  it('returns null for empty input', () => {
    expect(normalizeImageDataUrl(null)).toBeNull()
    expect(normalizeImageDataUrl(undefined)).toBeNull()
    expect(normalizeImageDataUrl('')).toBeNull()
  })

  it('passes through values that already carry a scheme', () => {
    expect(normalizeImageDataUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
    expect(normalizeImageDataUrl('https://example.com/a.png')).toBe('https://example.com/a.png')
  })

  it('prefixes bare base64, which is how older saves stored it', () => {
    expect(normalizeImageDataUrl('AAA')).toBe('data:image/png;base64,AAA')
  })
})
