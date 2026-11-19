# A JSON value that crosses a scalar subquery needs `json()`

SQLite's JSON functions tell a JSON value from a plain string by a
hidden subtype, not by the text. `json_set`, `json_insert` and their
siblings store a value carrying that subtype as JSON, and anything
else as a quoted string. On SQLite 3.54 a value that comes out of a
scalar subquery has lost the subtype, so it lands as a string:

```sql
SELECT json_set('{}', '$.a', (SELECT json_group_array(1)));
-- 3.51.2: {"a":[1]}
-- 3.54.1: {"a":"[1]"}

SELECT json_set('{}', '$.a', json((SELECT json_group_array(1))));
-- both:   {"a":[1]}
```

## Why

`upsertCachedModelCapabilities` in `lib/actions/settings/providers.ts`
rebuilt a provider's `cachedModels` with exactly that shape. On 3.54.1
the array was written as a string, `rehydrateAppSettings` then rejected
the whole settings row (`cachedModels`: expected array, received
string), and the committed row stayed that way. The helper's inner
derived table already wrapped `json(merged)` for the same reason; only
the outer argument was missed.

It stayed hidden because every runtime that ran it had an older
SQLite. The unit project uses `node:sqlite` from the developer's Node,
which is not the SQLite the app ships:

| Runtime                                      | SQLite | Runs                             |
| -------------------------------------------- | ------ | -------------------------------- |
| Node 24.14.0                                 | 3.51.2 | unit tests, before the Node bump |
| Node 24.22.3                                 | 3.54.1 | unit tests, after it             |
| Electron 41.2.2                              | 3.51.2 | the desktop app and E2E          |
| expo-sqlite 55.0.16 (vendored, no SQLCipher) | 3.50.3 | Android                          |

The Node bump turned three unit tests red while both shipped runtimes
still behaved. The opposite direction is the dangerous one: an Electron
or expo-sqlite bump moves a shipped runtime to a newer SQLite while the
unit suite stays on the old one, and E2E covers only the paths it
drives.

## How to apply

- Wrap a subquery fed to a JSON function in `json(...)`. A subquery
  assigned straight to a column needs nothing: the column stores the
  text, and the subtype only matters as a function argument. `jsonArg`
  wraps bound parameters for the parallel reason, since a bound TEXT
  parameter never carries the subtype.
- On a bump of Node (`.nvmrc`), Electron or expo-sqlite, compare the
  three SQLite versions. Node and Electron print theirs with
  `-p process.versions.sqlite` (Electron under `ELECTRON_RUN_AS_NODE=1`);
  expo-sqlite's is `SQLITE_VERSION` in its vendored `sqlite3.h`. A
  difference means the unit suite tests a different SQLite from one
  that ships.
- A unit failure that appears only on a new Node is real SQL, not a
  test artifact. Check which side of the change each shipped runtime
  is on before calling it harmless.
