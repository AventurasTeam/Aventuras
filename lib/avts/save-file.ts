import type { AvtsFile } from './envelope'

/** Resolves once the browser takes the download; a cancelled or failed save never rejects. */
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
