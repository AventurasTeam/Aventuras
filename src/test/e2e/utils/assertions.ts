import { expect } from 'vitest'
import type { FetchInterceptor } from './FetchInterceptor'

// Request assertions

/**
 * Extract all text content from a captured request body.
 * Handles both Chat Completions API (messages[]) and Responses API (input[]) formats.
 */
function extractAllContent(body: any): string {
  // Chat Completions API: body.messages[].content (string or array)
  if (body.messages && Array.isArray(body.messages) && body.messages.length > 0) {
    return body.messages
      .map((m: any) => {
        if (typeof m.content === 'string') return m.content
        if (Array.isArray(m.content))
          return m.content.map((part: any) => part.text ?? part.input_text ?? '').join(' ')
        return ''
      })
      .join('\n')
  }

  // Responses API: body.input[].content (string or array of input_text parts)
  if (body.input && Array.isArray(body.input) && body.input.length > 0) {
    return body.input
      .map((m: any) => {
        if (typeof m.content === 'string') return m.content
        if (Array.isArray(m.content))
          return m.content.map((part: any) => part.text ?? part.input_text ?? '').join(' ')
        return ''
      })
      .join('\n')
  }

  return ''
}

export function expectPromptContains(
  interceptor: FetchInterceptor,
  serviceId: string,
  text: string,
) {
  const req = interceptor.getRequests(serviceId)[0]
  expect(req, `No request captured for serviceId '${serviceId}'`).toBeDefined()
  const allContent = extractAllContent(req.body)
  expect(allContent).toContain(text)
}

export function expectPromptNotContains(
  interceptor: FetchInterceptor,
  serviceId: string,
  text: string,
) {
  const req = interceptor.getRequests(serviceId)[0]
  if (!req) return // No request = text definitely not in prompt
  const allContent = extractAllContent(req.body)
  expect(allContent).not.toContain(text)
}

export function expectNoRequest(interceptor: FetchInterceptor, serviceId: string) {
  expect(interceptor.getRequests(serviceId)).toHaveLength(0)
}

export function expectRequestCount(
  interceptor: FetchInterceptor,
  serviceId: string,
  count: number,
) {
  expect(interceptor.getRequests(serviceId)).toHaveLength(count)
}
