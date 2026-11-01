import { describe, expect, it } from 'vitest'
import {
  groupLoadFailures,
  sortLoadFailures,
  type LoadFailure,
  type LoadedList,
} from './loadFailures'

const failure = (list: LoadedList, summary: string): LoadFailure => ({
  list,
  summary,
  detail: summary,
})

describe('sortLoadFailures', () => {
  it('orders failures by display order without changing the input', () => {
    const input = [failure('loras', 'a'), failure('schedulers', 'b'), failure('models', 'c')]
    expect(sortLoadFailures(input).map((f) => f.list)).toEqual(['models', 'schedulers', 'loras'])
    expect(input.map((f) => f.list)).toEqual(['loras', 'schedulers', 'models'])
  })
})

describe('groupLoadFailures', () => {
  it('puts failures with the same reason on one line, lists in display order', () => {
    const groups = groupLoadFailures([
      failure('vaes', '503 · Service Unavailable'),
      failure('models', '503 · Service Unavailable'),
      failure('loras', '503 · Service Unavailable'),
    ])
    expect(groups).toEqual([
      { lists: ['models', 'loras', 'vaes'], summary: '503 · Service Unavailable' },
    ])
  })

  it('keeps different reasons apart', () => {
    const groups = groupLoadFailures([
      failure('models', '401 · Invalid API key'),
      failure('loras', '404 · Not Found'),
    ])
    expect(groups.map((g) => g.lists)).toEqual([['models'], ['loras']])
  })

  it('groups a transport error that names a different URL per list, and drops the URL', () => {
    const groups = groupLoadFailures([
      failure(
        'models',
        'error sending request for url (http://192.168.1.5:8188/models/checkpoints)',
      ),
      failure('loras', 'error sending request for url (http://192.168.1.5:8188/models/loras)'),
    ])
    expect(groups).toEqual([
      { lists: ['models', 'loras'], summary: 'error sending request for url' },
    ])
  })

  it('keeps the original wording for a failure that stands alone', () => {
    const summary = 'error sending request for url (http://host/models/loras)'
    expect(groupLoadFailures([failure('loras', summary)])).toEqual([{ lists: ['loras'], summary }])
  })

  it('is empty when nothing failed', () => {
    expect(groupLoadFailures([])).toEqual([])
  })
})
