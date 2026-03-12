import { createLogger } from '$lib/log'

const log = createLogger('ImageUtils')

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
 * Parse an image size string (e.g., "1024x1024" or "800x600") into width and height.
 * Falls back to 1024x1024 if the format is invalid.
 */
export function parseImageSize(size: string): { width: number; height: number } {
  if (size === '512x512') return { width: 512, height: 512 }
  if (size === '1024x1024') return { width: 1024, height: 1024 }
  if (size === '2048x2048') return { width: 2048, height: 2048 }

  try {
    const parts = size.toLowerCase().split('x')
    if (parts.length === 2) {
      const width = parseInt(parts[0], 10)
      const height = parseInt(parts[1], 10)
      if (!isNaN(width) && !isNaN(height)) {
        return { width, height }
      }
    }
  } catch (e) {
    log('Failed to parse image size', { size, error: e })
  }

  return { width: 1024, height: 1024 }
}
