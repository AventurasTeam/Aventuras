/** In display order. */
export const LOADED_LISTS = [
  'models',
  'samplers',
  'schedulers',
  'loras',
  'textEncoders',
  'vaes',
] as const

export type LoadedList = (typeof LOADED_LISTS)[number]

export const LOADED_LIST_LABELS: Record<LoadedList, string> = {
  models: 'Models',
  samplers: 'Samplers',
  schedulers: 'Schedulers',
  loras: 'LoRAs',
  textEncoders: 'Text encoders',
  vaes: 'VAEs',
}

export interface LoadFailure {
  list: LoadedList
  summary: string
  detail: string
}

export interface FailureGroup {
  lists: LoadedList[]
  summary: string
}

// Each list asks its own route, so a transport error that names the request URL differs per list.
const withoutUrls = (summary: string) => summary.replace(/\s*\(?https?:\/\/[^\s)]+\)?/g, '').trim()

export function sortLoadFailures(failures: readonly LoadFailure[]): LoadFailure[] {
  return failures.toSorted((a, b) => LOADED_LISTS.indexOf(a.list) - LOADED_LISTS.indexOf(b.list))
}

/** Failures with the same reason as one entry, lists in display order. */
export function groupLoadFailures(failures: readonly LoadFailure[]): FailureGroup[] {
  const groups = new Map<string, FailureGroup>()
  for (const failure of sortLoadFailures(failures)) {
    const key = withoutUrls(failure.summary)
    const group = groups.get(key)
    if (group) group.lists.push(failure.list)
    else groups.set(key, { lists: [failure.list], summary: failure.summary })
  }
  return [...groups.entries()].map(([key, group]) =>
    group.lists.length > 1 ? { ...group, summary: key } : group,
  )
}
