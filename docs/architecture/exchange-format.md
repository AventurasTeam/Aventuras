# The exchange format

How Aventuras writes its own characters, lorebooks and scenarios to a file, and reads them back
without a model in the loop. Code lives in `services/exchange/`; the callers are the three vault
stores, `lorebookImportExport/export/`, and `lorebookImportExport/import/parse.ts`.

## The problem it solves

The vault used to export a character as `JSON.stringify(record)` and import it through the
SillyTavern card path. `isV1Card` accepts any object with `name` and `description`, so the app's
own export was mistaken for a V1 card, sent to the AI sanitizer, and came back without its
portrait, visual descriptors, tags, favourite state or metadata. Scenarios took the same route
through `clean`. Story lorebook exports were a raw `Entry[]` carrying record ids, story ids and
per-story state, and the vault importer re-classified every entry with a model whether or not the
file already said what each one was.

Content the app wrote must come back literally: no model call, no field loss, fresh local identity.

## The envelope

```json
{
  "format": "aventuras-exchange",
  "formatVersion": "1.0.0",
  "entity": "character",
  "exportedAt": 1730000000000,
  "data": {}
}
```

`entity` is `character`, `lorebook` or `scenario`, and `data` is validated by that entity's zod
schema in `services/exchange/schemas.ts`. The marker is the only thing that decides whether a file
is ours. There is no structural sniffing of unmarked files: a `{name, description}` object is a
card, and a bare array is nothing, however much it resembles an old export. That is what keeps the
ambiguity with `isV1Card` from ever arising.

The user-facing label stays "Aventura JSON". The module is named "exchange" because
`services/import/native.ts` already means _read natively through Rust_.

## Exchange-first, and no falling through

`parseExchange(text, expected)` runs before any external parser and returns one of three things:

| result     | meaning                                                             | caller does                            |
| ---------- | ------------------------------------------------------------------- | -------------------------------------- |
| `external` | no marker, or not JSON                                              | existing SillyTavern path, unchanged   |
| `exchange` | marker, supported version, expected entity, valid payload           | convert and save, no AI                |
| `invalid`  | marker but bad version, wrong or unknown entity, or invalid payload | remove the placeholder, show the error |

A declared Aventuras file that fails validation is terminal. It is never reinterpreted as a card or
a SillyTavern lorebook, and never reaches a model. Importing a lorebook export through the
character import is an `invalid` result with a message naming the right section.

## Portable content

Every payload carries the record's portable content and nothing else. Portable content is
everything on the record except:

- identity and timestamps: `id`, `createdAt`, `updatedAt`
- provenance: `source`, `originalFilename`, `originalStoryId`, `createdBy`
- derived metadata: `npcCount`, `hasFirstMessage`, `alternateGreetingsCount`, `format`,
  `totalEntries`, `entryBreakdown`
- database-local references and transients: `linkedLorebookId`, `importing`, `sourceUrl`,
  `storyId`, `branchId`
- per-story entry state: `state`, `adventureState`, `creativeState`

Import regenerates the first two groups, recomputes the third, drops the fourth and initialises the
fifth from the entry type. Portraits travel because they are already data URLs or external URLs.
Tags and favourite state are the user's organisation and travel too. A scenario's starting time is authored content and travels; on import it is
normalized through `normalizeTime`, so a hand-edited file cannot store 90 minutes as-is.

Metadata is filtered by a per-entity **allowlist** (`PORTABLE_METADATA` in
`services/exchange/convert.ts`), applied on export and again on import. `VaultCharacter.metadata`
is `Record<string, unknown>` and the scenario and lorebook metadata types have index signatures, so
a denylist would fail open: every future database-local key would leak until someone remembered to
add it. An allowlist fails closed and visibly; adding a key is a minor version bump.

## Entry state stays home

Every field that holds an entry id lives inside `state`, `adventureState` or `creativeState`:
`presentCharacters`, `presentItems`, `knownMembers`, `relatedEntries`, `witnesses`,
`lastSeenLocation`, `currentLocation`, and the `entryId` inside `changes`, `uses` and
`relationship.history`. Excluding state excludes every cross-reference, so no exchange document
contains an unresolvable id and no remapping rule is needed. On import, state is the type's default,
which is what the vault-to-story path always produced.

## Story-side fields stop at the vault

`hiddenInfo` and `loreManagementBlacklisted` are written only inside a story: by the entry form, by
the generation entity merger, and by the lore agent's merge. Every wizard path that seeds a story
from the vault starts them empty, and `VaultLorebookEntry` has never had them. The vault is the
story-agnostic source of lore; a story is its consumer and accumulates these on top.

A lorebook export from a story carries both as optional entry fields, so a story-to-story transfer
is literal. Importing that file into a story keeps them. Importing it into the vault drops them and
says so in a toast. The agent-facing converter in `LoreManagementService.ts` is not involved: the
lore agent is never shown `hiddenInfo`, and that stays true.

## AI eligibility follows the format

`importEntries` classifies only when the parse result's format is `sillytavern` and the caller
asked for it. An `aventura` result never reaches `classifyEntries`, whatever the checkbox in the
story import modal says, and the modal hides the checkbox for those files. The vault file importer
applies the same rule: an Aventura export is saved as parsed.

## Versions

`formatVersion` is semver; only the major and minor parts are compared.
Same major imports, with unknown fields ignored and a warning when the file's minor is newer than
the app's. A higher major is rejected with a message that says to update the app. There is no
feature-history table yet because at 1.0.0 it would be empty; the first 1.1.0 that adds a field
adds the warning for files that predate it.

Support for a shipped version must not be removed in a patch rollback: users may hold such files.

## What happened to the old formats

The pre-envelope raw `Entry[]` lorebook export is no longer recognised and reports "unknown
lorebook format". It was the only legacy shape the app could recognise, and recognising it was
what kept alive both the converter branch that copied a source story's `state` verbatim, ids and
all, and a second meaning of "Aventura" in the format list. Users with an old export re-export it
from the source story or vault. Pre-envelope character and scenario exports are indistinguishable
from cards and keep taking the card path, with the field loss described above.

## Tests

`services/exchange/exchange.test.ts` covers the envelope, the three version cases, every payload
schema, allowlisting, and round trips for all three entities. `lorebookImportExport/import/` has
the parser cases (`parse.test.ts`), the classification gate (`orchestrator.test.ts`) and the
story-to-story and story-to-vault round trips (`roundTrip.test.ts`). The vault stores are rune
modules and cannot be imported by Vitest; their exchange branches are thin calls into the tested
parser and converters.
