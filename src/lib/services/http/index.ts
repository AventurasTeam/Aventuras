export { httpFetch, type HttpInit } from './httpFetch'
export { loggedFetch, type LoggedFetchOptions } from './loggedFetch'
export {
  describeRequestBody,
  headerEntries,
  isBinaryContentType,
  logBinaryResponse,
  logErrorResponse,
  logJsonResponse,
  logResponse,
  logStatus,
  parseLoggedBody,
  redactHeaders,
  scrubBase64,
  type DebugEntry,
  type ResponseLogger,
} from './debugLog'
