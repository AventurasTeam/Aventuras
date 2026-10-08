import { File, Paths } from 'expo-file-system'

import type { AvtsFile } from './envelope'

const SHARE_OPTIONS = { mimeType: 'application/json', UTI: 'public.json' } as const

/** Resolves once handed to the OS (a dismissed share sheet or Save dialog still resolves); rejects if the hand-off fails. */
export async function saveAvtsFile(file: AvtsFile): Promise<void> {
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
