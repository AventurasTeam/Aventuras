---
summary: 'Hold sync_suspend for migrations and the app’s own writes, or sync sees every item they touch as changed on both devices.'
tags: [persistence]
cross-cutting: false
---

# Automatic writes are not sync edits, and migrations are held from outside

## Context and Problem Statement

Migration 045's triggers count an edit whenever a counted column is written or a child row of a story or pack changes, without comparing old and new values. So a write that every device makes alike, without the user doing anything, bumps each device's own counter, and the next sync sees every item that write touched as changed on both. The only guard was a rule in 045's comment, which nothing checked: each migration inserts and deletes a `sync_suspend` row itself. Wrapping each migration's text instead would change its checksum, and a checksum that drifts stops the app from starting, which is why `migration_patch.rs` exists. How do automatic writes stay out of the counts without any migration's text carrying the rule?

## Considered Options

* Hold `sync_suspend` around the whole migration run
* Each migration inserts and deletes the row itself, as 045 says
* `migrations()` wraps every migration's SQL, from the next one on
* A test that parses migration SQL for writes to counted tables

## Decision Outcome

Chosen option: "Hold `sync_suspend` around the whole migration run", because it covers every migration, past and future, and changes no released migration's text or checksum.

* **Migrations.** `setup` in `lib.rs` inserts the `('migration')` row once the checksum patch has run, if the table exists. `DatabaseService.init` deletes it right after `Database.load` returns, before any other statement. Restoring a backup exits the app, so a restored database also migrates under the hold.
* **A migration never manages the row.** An unqualified `DELETE FROM sync_suspend` in a migration would end the hold for the migrations after it. 045's comment says otherwise, but it predates this decision and cannot be edited.
* **Writes the app makes on its own go through `database.withoutSyncCounting`**, which runs them in one `db_transaction` with the row inserted first and deleted last, so a failure or a crash cannot leave it set. They are the template backfill, the startup sweep of unfinished images, the orphaned-image cleanup, the repair of chapters whose entries are gone, and the clock restored from the branch when a story opens or switches branch. A user's edit never goes through it.
* **Rewrite rows in place.** Deleting and re-inserting a row, or `REPLACE` on a root row, drops its sync identity even under the hold, because the delete triggers ignore the hold.

### Consequences

* Good, because adding a migration needs nothing from its author, and the rule can no longer be forgotten.
* Good, because the clock restore writes only when the stored clock differs, so opening a story does not touch its counters.
* Bad, because the hold is set in one place and cleared in another, which sync.md rejects for applying an item. It is accepted here because it lasts only one startup: `init` deletes the row on the next launch, whatever happened to the last one.
* Bad, because a database from before 045 has no `sync_suspend` table when `setup` runs, so the migrations from 045 on run without the hold. No identity or vector exists yet, so `stories.updated_at` is the only thing that can be stamped, and only once.
* Bad, because nothing checks that a new automatic write uses the helper. One that skips it is counted, which costs a conflict prompt but never data.

## More Information

[sync.md](../architecture/sync.md), [persistence.md](../architecture/persistence.md).
