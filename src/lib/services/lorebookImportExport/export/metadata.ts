/**
 * Export format metadata
 */

import type { ExportFormat } from '../types'

export function getFormatInfo(format: ExportFormat): {
  label: string
  description: string
  extension: string
} {
  switch (format) {
    case 'aventura':
      return {
        label: 'Aventura JSON',
        description: 'Full entry data, can be re-imported with all fields',
        extension: '.json',
      }
    case 'sillytavern':
      return {
        label: 'SillyTavern',
        description: 'Compatible with SillyTavern and other tools',
        extension: '.json',
      }
    case 'text':
      return {
        label: 'Plain Text',
        description: 'Simple readable format, not importable',
        extension: '.txt',
      }
  }
}
