import { File, Paths } from 'expo-file-system'

import type { AvtsFile } from './envelope'

const SHARE_OPTIONS = { mimeType: 'application/json', UTI: 'public.json' } as const

let pendingShare: Promise<void> | undefined

/**
 * Resolves when the share sheet closes, shared or not; rejects if the file or the sheet fails.
 * A call while a share is pending joins that share instead of sharing its own file.
 */
export function saveAvtsFile(file: AvtsFile): Promise<void> {
  // expo-sharing holds one share app-wide; Android rejects a second one (a double tap).
  pendingShare ??= share(file).finally(() => {
    pendingShare = undefined
  })
  return pendingShare
}

async function share(file: AvtsFile): Promise<void> {
  // Loaded on demand: a dev client built before expo-sharing fails here, not at module load.
  const Sharing = await import('expo-sharing')
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('saveAvtsFile: sharing is not available on this device')
  }
  const target = new File(Paths.cache, file.fileName)
  target.create({ overwrite: true })
  target.write(file.contents)
  await Sharing.shareAsync(target.uri, { ...SHARE_OPTIONS, dialogTitle: file.fileName })
}
