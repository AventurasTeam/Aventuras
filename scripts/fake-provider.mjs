#!/usr/bin/env node
/**
 * Fake provider, for driving the running app into provider failures by hand.
 *
 * Emulates an OpenAI-compatible chat API and the OpenAI image API on one port. What each request
 * does is chosen by the model name it asks for, so every service can be pointed at its own
 * failure from one profile. Setup and the model list: docs/development/testing.md.
 *
 *   npm run fake-provider [-- port]        (default 4010)
 *
 * No dependencies. Logs one line per request.
 */

import http from 'node:http'

const PORT = Number(process.argv[2] ?? 4010)

// --- Scenario models -------------------------------------------------------------------------
//
// A model name is a scenario. `-slow` may be appended to any of them to add a 4 s delay before
// the response starts, so the live line can be watched.

const CHAT_MODELS = [
  'ok', //             valid response; structured output is synthesised from the request schema
  'ok-fill', //        as ok, but arrays get one item and booleans are true (scenes, change detection)
  'fail-400', //       400 context length exceeded
  'fail-401', //       401 invalid API key
  'fail-403', //       403 permission denied
  'fail-404', //       404 model not found
  'fail-429', //       429 every time (the middleware gives up after 3 retries)
  'fail-429x2', //     429 twice, then ok (per model; the cycle repeats)
  'fail-429-ra3', //   429 once with Retry-After: 3, then ok
  'fail-429-ra900', // 429 with Retry-After: 900 (beyond the timeout: rethrown at once)
  'fail-500', //       500 internal error (the SDK retries 5xx on its own)
  'fail-500x1', //     500 once, then ok (an SDK-level retry, no wait row)
  'fail-502-html', //  502 with an HTML body (reason falls back to the status text)
  'fail-503', //       503 overloaded
  'fail-reset', //     connection closed without a response
  'fail-hang', //      never responds (the client times out)
  'empty', //          200 with empty content
  'malformed', //      200 with invalid JSON for structured output
  'partial', //        as ok-fill, plus one invalid element in the first list: only the classifier salvages the rest
  'stream-connection-lost', // streaming only: some text, then the connection drops
  'stream-cut-error', //       streaming only: some text, then an error event in the stream
]

const IMAGE_MODELS = [
  'img-ok',
  'img-fail-400', // content policy
  'img-fail-401',
  'img-fail-429',
  'img-fail-500',
  'img-empty', //    200 with no image data
  'img-hang',
]

// --- Error bodies ----------------------------------------------------------------------------

const ERRORS = {
  400: {
    message:
      "This model's maximum context length is 8192 tokens. Your messages resulted in 9001 tokens.",
    type: 'invalid_request_error',
    code: 'context_length_exceeded',
  },
  401: {
    message: 'Invalid API key provided.',
    type: 'invalid_request_error',
    code: 'invalid_api_key',
  },
  403: {
    message: 'You do not have access to this model.',
    type: 'permission_error',
    code: 'forbidden',
  },
  404: {
    message: 'The model does not exist.',
    type: 'invalid_request_error',
    code: 'model_not_found',
  },
  429: {
    message: 'Rate limit reached for requests.',
    type: 'rate_limit_error',
    code: 'rate_limit_exceeded',
  },
  500: {
    message: 'The server had an error while processing your request.',
    type: 'server_error',
    code: null,
  },
  503: { message: 'The engine is currently overloaded.', type: 'server_error', code: 'overloaded' },
}
const IMAGE_ERRORS = {
  400: {
    message: 'Your request was rejected by the safety system.',
    type: 'image_generation_user_error',
    code: 'content_policy_violation',
  },
}

// Failures served so far per counted scenario, so `x2` and `x1` recover.
const served = new Map()
const countedFailure = (key, times) => {
  const n = served.get(key) ?? 0
  if (n < times) {
    served.set(key, n + 1)
    return true
  }
  served.set(key, 0)
  return false
}

// --- Responses -------------------------------------------------------------------------------

const sendJson = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}
const sendError = (res, status, error, headers) => sendJson(res, status, { error }, headers)

/** A minimal instance of a JSON schema; `fill` puts one item in arrays and sets booleans true. */
function instance(schema, fill, root = schema, depth = 0) {
  if (!schema || depth > 12) return null
  if (schema.$ref) {
    const path = schema.$ref.replace(/^#\//, '').split('/')
    return instance(
      path.reduce((node, key) => node?.[key], root),
      fill,
      root,
      depth + 1,
    )
  }
  if (schema.const !== undefined) return schema.const
  if (schema.enum) return schema.enum[0]
  const variants = schema.anyOf ?? schema.oneOf
  if (variants) {
    const nonNull = variants.find((v) => v.type !== 'null')
    return instance(nonNull ?? variants[0], fill, root, depth + 1)
  }
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type
  switch (type) {
    case 'object': {
      const out = {}
      for (const key of schema.required ?? Object.keys(schema.properties ?? {})) {
        // A scene's quote must occur in the narration, or its image is placed nowhere.
        out[key] =
          key === 'sourceText'
            ? NARRATION_QUOTE
            : instance(schema.properties?.[key], fill, root, depth + 1)
      }
      return out
    }
    case 'array': {
      const count = Math.max(schema.minItems ?? 0, fill ? 1 : 0)
      return Array.from({ length: count }, () => instance(schema.items, fill, root, depth + 1))
    }
    case 'string':
      return 'x'.repeat(Math.max(1, schema.minLength ?? 1))
    case 'integer':
    case 'number':
      return schema.minimum ?? 1
    case 'boolean':
      return fill
    case 'null':
      return null
    default:
      return null
  }
}

/** Adds an element missing every required field to the first list of objects, so validation fails. */
function breakFirstList(node) {
  if (Array.isArray(node)) {
    if (node.length && typeof node[0] === 'object' && node[0] !== null) {
      node.push({})
      return true
    }
    return node.some(breakFirstList)
  }
  if (node && typeof node === 'object') return Object.values(node).some(breakFirstList)
  return false
}

const NARRATION = 'The dragon fell from the sky, and the valley was quiet again.'
// Within the text a cut stream keeps, too: it breaks off after `sky`.
const NARRATION_QUOTE = 'The dragon fell from the sky'

function chatContent(body, scenario) {
  if (scenario === 'empty') return ''
  const format = body.response_format
  const structured = format?.type === 'json_schema' || format?.type === 'json_object'
  if (scenario === 'malformed') return structured ? '{"not": "what you asked for", ' : 'x'
  if (format?.type === 'json_schema') {
    const filled = instance(
      format.json_schema?.schema,
      scenario === 'ok-fill' || scenario === 'partial',
    )
    if (scenario === 'partial') breakFirstList(filled)
    return JSON.stringify(filled)
  }
  if (format?.type === 'json_object') return '{}'
  return NARRATION
}

const completion = (model, content) => ({
  id: `chatcmpl-${Date.now()}`,
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model,
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
})

/** `cut`: how the stream breaks off after `sky`, if it does — `'connection'` or `'error'`. */
async function streamCompletion(res, model, content, cut) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  const chunk = (delta, finish = null) =>
    `data: ${JSON.stringify({
      id: 'chatcmpl-stream',
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`
  res.write(chunk({ role: 'assistant', content: '' }))
  for (const word of content.split(/(?<= )/)) {
    await sleep(60)
    res.write(chunk({ content: word }))
    if (cut && word.includes('sky')) {
      if (cut === 'connection') {
        res.socket.destroy()
        return
      }
      // As OpenRouter reports an upstream failure once the 200 and some text are already sent.
      res.write(
        `data: ${JSON.stringify({
          error: {
            message: 'Upstream provider stopped responding',
            type: 'server_error',
            code: 502,
          },
        })}\n\n`,
      )
      res.write('data: [DONE]\n\n')
      res.end()
      return
    }
  }
  res.write(chunk({}, 'stop'))
  res.write('data: [DONE]\n\n')
  res.end()
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// --- Routes ----------------------------------------------------------------------------------

async function chat(req, res, body) {
  const requested = String(body.model ?? '')
  const slow = requested.endsWith('-slow')
  const scenario = slow ? requested.slice(0, -5) : requested
  if (slow) await sleep(4000)

  switch (scenario) {
    case 'fail-400':
    case 'fail-401':
    case 'fail-403':
    case 'fail-404':
    case 'fail-500':
    case 'fail-503': {
      const status = Number(scenario.slice(5))
      return sendError(res, status, ERRORS[status])
    }
    case 'fail-429':
      return sendError(res, 429, ERRORS[429])
    case 'fail-429x2':
      if (countedFailure(requested, 2)) return sendError(res, 429, ERRORS[429])
      break
    case 'fail-429-ra3':
      if (countedFailure(requested, 1))
        return sendError(res, 429, ERRORS[429], { 'Retry-After': '3' })
      break
    case 'fail-429-ra900':
      return sendError(res, 429, ERRORS[429], { 'Retry-After': '900' })
    case 'fail-500x1':
      if (countedFailure(requested, 1)) return sendError(res, 500, ERRORS[500])
      break
    case 'fail-502-html':
      res.writeHead(502, { 'Content-Type': 'text/html' })
      return res.end('<html><body><h1>502 Bad Gateway</h1></body></html>')
    case 'fail-reset':
      return req.socket.destroy()
    case 'fail-hang':
      return // never answers
  }

  const content = chatContent(body, scenario)
  if (body.stream) {
    const cut = { 'stream-connection-lost': 'connection', 'stream-cut-error': 'error' }[scenario]
    return streamCompletion(res, requested, content, cut)
  }
  return sendJson(res, 200, completion(requested, content))
}

// 1x1 transparent PNG.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

async function image(req, res, body) {
  const scenario = String(body.model ?? '')
  switch (scenario) {
    case 'img-fail-400':
      return sendError(res, 400, IMAGE_ERRORS[400])
    case 'img-fail-401':
      return sendError(res, 401, ERRORS[401])
    case 'img-fail-429':
      return sendError(res, 429, ERRORS[429])
    case 'img-fail-500':
      return sendError(res, 500, ERRORS[500])
    case 'img-empty':
      return sendJson(res, 200, { created: Math.floor(Date.now() / 1000), data: [] })
    case 'img-hang':
      return
  }
  await sleep(1500)
  sendJson(res, 200, { created: Math.floor(Date.now() / 1000), data: [{ b64_json: PNG }] })
}

const models = () => ({
  object: 'list',
  data: [...CHAT_MODELS, ...CHAT_MODELS.map((m) => `${m}-slow`), ...IMAGE_MODELS].map((id) => ({
    id,
    object: 'model',
    owned_by: 'fake-provider',
  })),
})

http
  .createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname.replace(/^\/v1/, '')
    let raw = ''
    for await (const part of req) raw += part
    let body = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      /* not JSON */
    }
    console.log(
      `${new Date().toISOString().slice(11, 19)} ${req.method} ${path} ${body.model ?? ''}${body.stream ? ' (stream)' : ''}`,
    )
    if (req.method === 'GET' && path === '/models') return sendJson(res, 200, models())
    if (req.method === 'POST' && path === '/chat/completions') return chat(req, res, body)
    if (req.method === 'POST' && path === '/images/generations') return image(req, res, body)
    sendError(res, 404, { message: `No route for ${req.method} ${path}`, type: 'not_found' })
  })
  .listen(PORT, () => console.log(`fake provider on http://localhost:${PORT}/v1`))
