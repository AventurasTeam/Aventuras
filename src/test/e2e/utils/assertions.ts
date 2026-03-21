import { expect } from 'vitest'
import type { FetchInterceptor } from './FetchInterceptor'

// Request assertions

export function expectPromptContains(
  interceptor: FetchInterceptor,
  serviceId: string,
  text: string,
) {
  const req = interceptor.getRequests(serviceId)[0]
  expect(req, `No request captured for serviceId '${serviceId}'`).toBeDefined()
  const messages = req.body.messages ?? []
  const allContent = messages.map((m: any) => m.content).join('\n')
  expect(allContent).toContain(text)
}

export function expectPromptNotContains(
  interceptor: FetchInterceptor,
  serviceId: string,
  text: string,
) {
  const req = interceptor.getRequests(serviceId)[0]
  if (!req) return // No request = text definitely not in prompt
  const messages = req.body.messages ?? []
  const allContent = messages.map((m: any) => m.content).join('\n')
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
