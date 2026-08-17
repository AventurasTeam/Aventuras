// Web and Electron already have a streaming-capable fetch; the Request built by
// the capture wrapper carries method, headers, body and signal, so it goes
// straight through. The native counterpart cannot use a Request — see
// platform-fetch.native.ts.
export function platformFetch(
  request: Request,
  _body: BodyInit | null | undefined,
): Promise<Response> {
  return fetch(request)
}
