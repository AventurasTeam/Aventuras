import type { AvtsFile } from './envelope'

/** Resolves once handed to the OS (a dismissed share sheet or Save dialog still resolves); rejects if the hand-off fails. */
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
