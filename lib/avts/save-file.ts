import type { AvtsFile } from './envelope'

/** Resolves once handed to the OS (even if the dialog is dismissed); rejects if hand-off fails. */
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
