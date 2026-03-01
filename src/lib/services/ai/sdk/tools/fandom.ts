/**
 * Fandom Wiki Tools
 *
 * Tool definitions for searching and fetching content from Fandom wikis.
 * Used by InteractiveVaultService to help users create entries from wiki content.
 */

import { tool } from 'ai'
import { z } from 'zod'
import {
  FandomService,
  type FandomSearchResult,
  type FandomArticleInfo,
  type FandomSectionContent,
} from '../../../fandom'

/**
 * Context provided to fandom tools.
 */
export interface FandomToolContext {
  /** FandomService instance for API calls */
  fandomService: FandomService
}

/**
 * Create fandom wiki tools with the given context.
 */
export function createFandomTools(context: FandomToolContext) {
  const { fandomService } = context

  return {
    /**
     * Search for articles on a Fandom wiki.
     */
    search_fandom: tool({
      description:
        'Search for articles on a Fandom wiki (e.g., "harrypotter", "starwars", "lotr"). Returns article titles and snippets.',
      inputSchema: z.object({
        wiki: z
          .string()
          .describe('The wiki subdomain (e.g., "harrypotter", "starwars", "lotr", "elderscrolls")'),
        query: z.string().describe('Search query'),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe('Maximum results to return (default: 10, max: 50)'),
      }),
      execute: async ({
        wiki,
        query,
        limit,
      }: {
        wiki: string
        query: string
        limit?: number
      }): Promise<{ success: boolean; results?: FandomSearchResult[]; error?: string }> => {
        try {
          const results = await fandomService.search(wiki, query, limit ?? 10)
          return {
            success: true,
            results,
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to search wiki',
          }
        }
      },
    }),

    /**
     * Get article structure and metadata without full content.
     */
    get_fandom_article_info: tool({
      description:
        'Get the structure of a Fandom wiki article including its sections and categories. Use this to understand what content is available before fetching specific sections.',
      inputSchema: z.object({
        wiki: z.string().describe('The wiki subdomain'),
        title: z.string().describe('Exact article title (from search results)'),
      }),
      execute: async ({
        wiki,
        title,
      }: {
        wiki: string
        title: string
      }): Promise<{ success: boolean; info?: FandomArticleInfo; error?: string }> => {
        try {
          const info = await fandomService.getArticleInfo(wiki, title)
          return {
            success: true,
            info,
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to get article info',
          }
        }
      },
    }),

    /**
     * Fetch a specific section of an article.
     */
    fetch_fandom_section: tool({
      description:
        'Fetch a specific section of a Fandom wiki article by section index. Use "0" for the introduction/lead section. Get section indices from get_fandom_article_info.',
      inputSchema: z.object({
        wiki: z.string().describe('The wiki subdomain'),
        title: z.string().describe('Exact article title'),
        sectionIndex: z
          .string()
          .describe(
            'Section index (use "0" for intro, or get indices from get_fandom_article_info)',
          ),
      }),
      execute: async ({
        wiki,
        title,
        sectionIndex,
      }: {
        wiki: string
        title: string
        sectionIndex: string
      }): Promise<{ success: boolean; section?: FandomSectionContent; error?: string }> => {
        try {
          const section = await fandomService.getSection(wiki, title, sectionIndex)
          return {
            success: true,
            section,
          }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to fetch section',
          }
        }
      },
    }),
  }
}

export type FandomTools = ReturnType<typeof createFandomTools>
