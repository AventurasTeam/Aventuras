import type { AvtsFile } from './envelope'

/**
 * Resolves at the download hand-off: a cancelled or failed write never rejects, so a failed desktop
 * save goes unreported (the main-process fix is docs/implementation/roadmap.md → M9.4).
 */
export async function saveAvtsFile(file: AvtsFile): Promise<void> {
  const url = URL.createObjectURL(new Blob([file.contents], { type: 'application/json' }))
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.fileName
    anchor.click()
  } finally {
    // A later turn: the download must have taken the URL before it is revoked.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}
