import type { DownloadFailureCode } from '@/components/compounds/embedder-download-dialog-machine'

/**
 * A download failure that survives the throw with its cause intact. The message
 * stays English on purpose — it is diagnostic payload for the log, never the
 * string a user reads; the dialog renders localized copy from `code`.
 */
export class EmbedderDownloadError extends Error {
  readonly code: DownloadFailureCode

  constructor(code: DownloadFailureCode, message: string) {
    super(message)
    this.name = 'EmbedderDownloadError'
    this.code = code
  }
}

export function downloadFailureCode(error: unknown): DownloadFailureCode {
  return error instanceof EmbedderDownloadError ? error.code : 'unknown'
}
