import { externalLinkPath } from '@/lib/external-link'

export function redirectSystemPath({
  path,
  initial,
}: {
  path: string
  initial: boolean
}): string | null {
  return externalLinkPath(path, { initial, dev: __DEV__ })
}
