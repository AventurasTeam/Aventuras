import { beforeEach, describe, expect, it, vi } from 'vitest'

const { corsFetchMock } = vi.hoisted(() => ({
  corsFetchMock: vi.fn(),
}))

vi.mock('../utils', () => ({
  corsFetch: corsFetchMock,
}))

import { BackyardProvider } from './backyard'

function jsonResponse(value: unknown): Response {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(value),
  } as unknown as Response
}

function decodeTrpcInput(requestUrl: string): Record<string, unknown> {
  const encodedInput = new URL(requestUrl).searchParams.get('input')
  expect(encodedInput).not.toBeNull()
  const batch = JSON.parse(encodedInput!) as { '0': { json: Record<string, unknown> } }
  return batch['0'].json
}

describe('BackyardProvider', () => {
  beforeEach(() => {
    corsFetchMock.mockReset()
  })

  it('searches the tRPC endpoint, maps a character, and reuses its cursor', async () => {
    corsFetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          {
            result: {
              data: {
                json: {
                  nextCursor: 'cursor-2',
                  hubGroupConfigs: [
                    {
                      id: 'group-7',
                      tagline: 'A patient investigator.',
                      downloadCount: 42,
                      isNSFW: false,
                      Author: { username: 'garden-author' },
                      Tags: [{ name: 'Mystery' }, { name: 'Detective' }],
                      CharacterConfigs: [
                        {
                          id: 'config-9',
                          displayName: 'Iris Vale',
                          Images: [{ imageUrl: 'https://cdn.example/upload/iris.png' }],
                        },
                      ],
                    },
                    {
                      id: 'group-nsfw',
                      isNSFW: true,
                      CharacterConfigs: [{ id: 'config-nsfw', displayName: 'Filtered Character' }],
                    },
                  ],
                },
              },
            },
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ result: { data: { json: { hubGroupConfigs: [] } } } }]),
      )

    const provider = new BackyardProvider()
    const result = await provider.search(
      {
        query: '  Iris  ',
        page: 1,
        sort: 'new',
        nsfw: false,
        tags: ['Mystery'],
      },
      'character',
    )

    const [requestUrl, init] = corsFetchMock.mock.calls[0] as [string, RequestInit]
    const url = new URL(requestUrl)
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://backyard.ai/api/trpc/hub.browse.getHubGroupConfigsForTag',
    )
    expect(url.searchParams.get('batch')).toBe('1')
    expect(decodeTrpcInput(requestUrl)).toEqual({
      tagNames: ['Mystery'],
      sortBy: { type: 'New', direction: 'desc' },
      type: 'all',
      direction: 'forward',
      search: 'Iris',
    })
    expect(init).toEqual({
      method: 'GET',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    })
    expect(init.body).toBeUndefined()

    expect(result).toEqual({
      cards: [
        {
          id: 'config-9',
          name: 'Iris Vale',
          creator: 'garden-author',
          description: 'A patient investigator.',
          avatarUrl: 'https://cdn.example/upload/w_300,c_fill,g_north,f_auto,q_auto/iris.png',
          imageUrl: 'https://backyard.ai/hub/character/group-7',
          tags: ['Mystery', 'Detective'],
          stats: { downloads: 42 },
          source: 'backyard',
          type: 'character',
          nsfw: false,
          raw: {
            id: 'group-7',
            tagline: 'A patient investigator.',
            downloadCount: 42,
            isNSFW: false,
            Author: { username: 'garden-author' },
            Tags: [{ name: 'Mystery' }, { name: 'Detective' }],
            CharacterConfigs: [
              {
                id: 'config-9',
                displayName: 'Iris Vale',
                Images: [{ imageUrl: 'https://cdn.example/upload/iris.png' }],
              },
            ],
            groupId: 'group-7',
          },
        },
      ],
      hasMore: true,
      nextPage: 2,
    })

    await provider.search({ query: 'Iris', page: 2 }, 'character')
    const [secondUrl] = corsFetchMock.mock.calls[1] as [string, RequestInit]
    expect(decodeTrpcInput(secondUrl)).toEqual(
      expect.objectContaining({ search: 'Iris', cursor: 'cursor-2' }),
    )
  })

  it('keeps NSFW groups when NSFW results are requested', async () => {
    corsFetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          result: {
            data: {
              json: {
                hubGroupConfigs: [
                  {
                    id: 'group-nsfw',
                    isNSFW: true,
                    CharacterConfigs: [{ id: 'config-nsfw', displayName: 'Unfiltered Character' }],
                  },
                ],
              },
            },
          },
        },
      ]),
    )

    const result = await new BackyardProvider().search({ query: '', nsfw: true }, 'character')

    expect(result.cards.map((card) => card.id)).toEqual(['config-nsfw'])
    expect(result.cards[0].nsfw).toBe(true)
  })

  it('advances past filtered-only pages without hiding later safe results', async () => {
    corsFetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          {
            result: {
              data: {
                json: {
                  nextCursor: 'safe-page',
                  hubGroupConfigs: [
                    {
                      id: 'group-nsfw',
                      isNSFW: true,
                      CharacterConfigs: [{ id: 'config-nsfw', displayName: 'Filtered Character' }],
                    },
                  ],
                },
              },
            },
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            result: {
              data: {
                json: {
                  nextCursor: 'cursor-3',
                  hubGroupConfigs: [
                    {
                      id: 'group-safe',
                      isNSFW: false,
                      CharacterConfigs: [{ id: 'config-safe', displayName: 'Safe Character' }],
                    },
                  ],
                },
              },
            },
          },
        ]),
      )

    const result = await new BackyardProvider().search(
      { query: 'adventure', page: 1, nsfw: false },
      'character',
    )

    expect(corsFetchMock).toHaveBeenCalledTimes(2)
    expect(decodeTrpcInput(corsFetchMock.mock.calls[1][0])).toEqual(
      expect.objectContaining({ search: 'adventure', cursor: 'safe-page' }),
    )
    expect(result.cards.map((card) => card.id)).toEqual(['config-safe'])
    expect(result).toEqual(expect.objectContaining({ hasMore: true, nextPage: 2 }))
  })

  it('builds a stable page URL and downloads full character data as JSON', async () => {
    const provider = new BackyardProvider()
    const card = {
      id: 'config-9',
      name: 'Iris Vale',
      creator: 'garden-author',
      description: 'A patient investigator.',
      avatarUrl: '',
      tags: ['Mystery'],
      source: 'backyard',
      type: 'character' as const,
      nsfw: false,
      raw: { groupId: 'group-7' },
    }

    expect(await provider.getDownloadUrl(card)).toBe('https://backyard.ai/hub/character/group-7')

    corsFetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          result: {
            data: {
              json: {
                id: 'config-9',
                displayName: 'Iris Vale',
                persona: 'Observant and methodical.',
                creatorNotes: 'Original card notes.',
                Author: { username: 'garden-author' },
                Tags: [{ name: 'Mystery' }],
                standaloneGroupConfig: {
                  id: 'group-7',
                  PrimaryChat: {
                    context: 'A locked-room mystery.',
                    HubGreetingMessages: [{ text: 'The door was locked.' }, { text: 'Again?' }],
                    HubExampleMessages: [{ characterName: 'Iris', text: 'Check the hinges.' }],
                  },
                },
                LorebookItems: [{ key: 'Manor', value: 'An isolated old house.' }],
              },
            },
          },
        },
      ]),
    )

    const blob = await provider.downloadCard(card)
    const [requestUrl, init] = corsFetchMock.mock.calls[0] as [string, RequestInit | undefined]
    expect(requestUrl).toContain('/hub.browse.getHubCharacterConfigById?batch=1&input=')
    expect(decodeTrpcInput(requestUrl)).toEqual({
      hubCharacterConfigId: 'config-9',
      includeStandaloneGroupConfig: true,
    })
    expect(init).toBeUndefined()
    expect(blob.type).toBe('application/json')
    expect(JSON.parse(await blob.text())).toEqual({
      name: 'Iris Vale',
      description: 'Observant and methodical.',
      personality: '',
      scenario: 'A locked-room mystery.',
      first_mes: 'The door was locked.',
      mes_example: '<START>\nIris: Check the hinges.',
      creator_notes: 'Original card notes.',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: ['Again?'],
      character_book: {
        name: 'Iris Vale Lorebook',
        entries: [
          {
            id: 1,
            keys: ['Manor'],
            secondary_keys: [],
            content: 'An isolated old house.',
            comment: 'Manor',
            enabled: true,
            constant: false,
            selective: false,
            insertion_order: 100,
            position: 'before_char',
          },
        ],
      },
      tags: ['Mystery'],
      creator: 'garden-author',
      character_version: '1.0',
      extensions: { backyard: { id: 'config-9', groupId: 'group-7' } },
    })
  })
})
