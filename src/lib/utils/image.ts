export function normalizeImageDataUrl(imageData: string | null | undefined): string | null {
  if (!imageData) {
    return null
  }
  if (
    imageData.startsWith('data:image/') ||
    imageData.startsWith('http://') ||
    imageData.startsWith('https://')
  ) {
    return imageData
  }
  // Backward compatibility: stored as raw base64 without a data URL prefix.
  return `data:image/png;base64,${imageData}`
}

/**
 * Image size is stored as an intent — orientation + size tier — not as pixels.
 *
 * The backends disagree on what a size even is: Google takes an aspect ratio from a closed
 * list and has no pixel parameter, OpenRouter takes ratio + `1K`/`2K`/`4K`, NanoGPT
 * publishes a per-model list of accepted values, and only ComfyUI/A1111/Pollinations take
 * arbitrary dimensions. There is no pixel size they all accept, so each adapter resolves
 * the intent into whatever its backend takes.
 */

export type ImageOrientation = 'square' | 'landscape' | 'portrait'
export type ImageSizeTier = 'tiny' | 'small' | 'medium' | 'large'

export interface ImageSpec {
  orientation: ImageOrientation
  size: ImageSizeTier
}

export interface ImageResolution {
  width: number
  height: number
}

export const IMAGE_ORIENTATIONS: readonly ImageOrientation[] = ['square', 'landscape', 'portrait']
export const IMAGE_SIZE_TIERS: readonly ImageSizeTier[] = ['tiny', 'small', 'medium', 'large']

/**
 * The single definition of what each orientation means, as `[w, h]`.
 *
 * Pixels and the `w:h` strings sent to ratio-only providers are both derived from this, so
 * "Landscape" is 16:9 everywhere.
 */
const ORIENTATION_RATIO: Record<ImageOrientation, [number, number]> = {
  square: [1, 1],
  landscape: [16, 9],
  portrait: [9, 16],
}

/** Long edge in pixels per tier. The short edge follows from the orientation's ratio. */
const TIER_LONG_EDGE: Record<ImageSizeTier, number> = {
  tiny: 512,
  small: 1024,
  medium: 1536,
  large: 2048,
}

/** Diffusion backends want dimensions on a grid; 16 divides every value this produces. */
const PIXEL_GRID = 16

const DEFAULT_SPEC: ImageSpec = { orientation: 'square', size: 'small' }

/** A fresh default — a shared object would let one caller's mutation move it app-wide. */
export function defaultImageSpec(): ImageSpec {
  return { ...DEFAULT_SPEC }
}

/** Pixels for a spec, for the backends that take real dimensions. */
export function specToPixels(spec: ImageSpec): ImageResolution {
  const [rw, rh] = ORIENTATION_RATIO[spec.orientation]
  const long = TIER_LONG_EDGE[spec.size]
  const short = Math.round((long * Math.min(rw, rh)) / Math.max(rw, rh) / PIXEL_GRID) * PIXEL_GRID
  return rw >= rh ? { width: long, height: short } : { width: short, height: long }
}

/** `WIDTHxHEIGHT`, for the providers whose parameter is a string in that shape. */
export function formatImageSize(res: ImageResolution): string {
  return `${res.width}x${res.height}`
}

/**
 * Dimensions to record against a pending image, before there is an image.
 *
 * The placeholder reserves the right shape of space while the request is out. Ratio-only
 * backends will return something else, so what matters here is the orientation.
 */
export function expectedPixels(size: ImageSpec | string | null | undefined): ImageResolution {
  return specToPixels(parseImageSpec(size))
}

/** The canonical `w:h` for an orientation. */
export function specToRatioString(spec: ImageSpec): string {
  const [w, h] = ORIENTATION_RATIO[spec.orientation]
  return `${w}:${h}`
}

/**
 * The ratio to send to a provider that takes one, given the ratios it accepts.
 *
 * Falls back to the closest by shape rather than to `1:1`, so a landscape request that the
 * provider cannot serve exactly still comes back landscape. Compared in log space: on a
 * linear scale portrait ratios crowd into (0, 1] while landscape ones spread over [1, ∞),
 * which biases every near-miss towards square.
 */
export function specToAspectRatio(spec: ImageSpec, supported: readonly string[]): string {
  const preferred = specToRatioString(spec)
  if (supported.includes(preferred)) return preferred

  const target = ratioValue(preferred)
  // Seeded with `preferred` so a wholly unparseable list yields a well-formed ratio.
  let best = preferred
  let bestDistance = Infinity

  for (const candidate of supported) {
    const value = ratioValue(candidate)
    if (!Number.isFinite(value) || value <= 0) continue
    const distance = Math.abs(Math.log(value / target))
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }

  return best
}

function ratioValue(ratio: string): number {
  const [w, h] = ratio.split(':').map(Number)
  return h > 0 ? w / h : NaN
}

/**
 * Read a stored size into a spec.
 *
 * Settings hold an `ImageSpec`; the `WIDTHxHEIGHT` strings written by older builds are
 * still accepted and read as the intent they were approximating, so there is no migration
 * to run before a profile can be used.
 */
export function parseImageSpec(value: ImageSpec | string | null | undefined): ImageSpec {
  if (!value) return defaultImageSpec()

  if (typeof value === 'object') {
    return {
      orientation: IMAGE_ORIENTATIONS.includes(value.orientation)
        ? value.orientation
        : DEFAULT_SPEC.orientation,
      size: IMAGE_SIZE_TIERS.includes(value.size) ? value.size : DEFAULT_SPEC.size,
    }
  }

  const text = value.trim().toLowerCase()

  // `×` as well as `x`: it is what the old size badge rendered, so it is what a user
  // retyping what they saw would produce.
  const pixels = /^(\d+)\s*[x×]\s*(\d+)$/.exec(text)
  if (pixels) {
    const width = Number(pixels[1])
    const height = Number(pixels[2])
    if (width > 0 && height > 0) return specFromPixels(width, height)
  }

  return defaultImageSpec()
}

/** Tier boundaries sit midway between the long edges above, so each value lands on its row. */
function tierForLongEdge(longEdge: number): ImageSizeTier {
  const tiers = IMAGE_SIZE_TIERS
  for (let i = 0; i < tiers.length - 1; i++) {
    const midpoint = (TIER_LONG_EDGE[tiers[i]] + TIER_LONG_EDGE[tiers[i + 1]]) / 2
    if (longEdge <= midpoint) return tiers[i]
  }
  return tiers[tiers.length - 1]
}

/**
 * Classify a pixel size into the spec it was approximating.
 *
 * The square band is ±2%: wide enough to absorb rounding, narrow enough that a genuinely
 * wide image is not read as square.
 */
export function specFromPixels(width: number, height: number): ImageSpec {
  const ratio = width / height
  const orientation: ImageOrientation =
    Math.abs(ratio - 1) < 0.02 ? 'square' : ratio > 1 ? 'landscape' : 'portrait'

  return { orientation, size: tierForLongEdge(Math.max(width, height)) }
}

/** Human-readable, for the widget and for logs. */
export function describeImageSpec(spec: ImageSpec): string {
  const { width, height } = specToPixels(spec)
  return `${spec.orientation} ${spec.size} (${width}x${height})`
}
