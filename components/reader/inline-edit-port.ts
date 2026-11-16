import type { InlineEditPort } from '@/hooks/use-inline-edit-guard'

import type { EditRequests } from './edit-bridge-requests'
import type { ReaderSurfaceHandle } from './reader-document-types'

/** The edit requests the reader document answers, by request id, over the bridge. */
export type EditDocumentHandle = {
  queryEditSession: (requestId: string) => void
  commitDraft: (requestId: string) => void
  discardDraft: () => void
}

/** Web: the surface runs in-process, so the guard reads and commits through its handle. */
export function webEditPort(surface: () => ReaderSurfaceHandle | null): InlineEditPort {
  return {
    query: async () => surface()?.editSession() ?? null,
    commit: async () => (await surface()?.commitDraft()) ?? { ok: true },
    discard: () => surface()?.discardDraft(),
  }
}

/** Native: each request crosses the bridge and the document answers it by id. */
export function nativeEditPort(
  requests: EditRequests,
  document: () => Partial<EditDocumentHandle> | null,
): InlineEditPort {
  // The expo-dom proxy hands back no method for a handle the document hasn't registered yet.
  return {
    query: () => requests.ask('query', (id) => document()?.queryEditSession?.(id)),
    commit: () => requests.ask('commit', (id) => document()?.commitDraft?.(id)),
    discard: () => document()?.discardDraft?.(),
  }
}
