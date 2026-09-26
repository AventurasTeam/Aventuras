/**
 * The Aventuras exchange format: the self-identifying, versioned document the app writes for
 * its own characters, lorebooks, and scenarios, and reads back literally, without AI.
 * See docs/architecture/exchange-format.md.
 */

export type {
  ExchangeCharacter,
  ExchangeDocument,
  ExchangeEntity,
  ExchangeLorebook,
  ExchangeLorebookEntry,
  ExchangeParseResult,
  ExchangeScenario,
  ExchangeScenarioNpc,
} from './types'
export { EXCHANGE_FORMAT, EXCHANGE_FORMAT_VERSION } from './types'
export { parseExchange, classifyExchange, exchangeImportRedirect } from './parse'
export { checkFormatVersion } from './version'
export {
  PORTABLE_METADATA,
  portableMetadata,
  wrapExchange,
  serializeExchange,
  characterToExchange,
  exchangeToCharacter,
  scenarioToExchange,
  exchangeToScenario,
  vaultLorebookToExchange,
  storyEntriesToExchange,
  exchangeToVaultLorebook,
  hasStorySideFields,
  entryBreakdown,
} from './convert'
