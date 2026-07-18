// juice ships types for its Node entry only; the client build (cheerio-only,
// what native imports) has the same call signature.
declare module 'juice/client' {
  import juice from 'juice'

  export default juice
}
