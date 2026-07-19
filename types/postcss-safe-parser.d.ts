declare module 'postcss-safe-parser' {
  import type { Parser, Root } from 'postcss'

  const safeParse: Parser<Root>
  export default safeParse
}
