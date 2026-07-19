import type { ReactNode } from 'react'

export type RichEntryContentProps = {
  /** Marked output, pre-juice — the rich path sanitizes it itself. */
  markedHtml: string
  /** Height-cache key on native; caching is skipped when absent. */
  entryId?: string
  /**
   * Plain RNRH rendering of the same content. Native shows it while the
   * WebView boots (underlay + single swap); web ignores it.
   */
  underlay: ReactNode
}
