# Local network sync

Two devices on one network pair with a QR code or a connection code. The one showing it runs a
server; the one that scanned or entered it, the client, drives everything. Sync carries five sections: stories, characters,
lorebooks, scenarios and prompt packs.

Code lives in `src-tauri/src/sync/` (the server and its protocol), `services/sync/` (status, rows,
transfers) and `components/sync/`.

## Why items carry a version vector

Every import assigns new local IDs, so the same item has different IDs on each device, and a title
tells nothing once something is renamed. Each item therefore gets a **sync ID** the first time it
is sent or received, kept by every device that holds it (`sync_identity`).

Knowing two copies are the same item is half the problem. The other half is the question the sync
screen answers: which side moved on since they last agreed? Each item holds a **version vector**
(`sync_vector`): one counter per device, and a device only ever increases its own.

- equal: in sync
- mine is at least theirs everywhere, and greater somewhere: newer here
- theirs is at least mine everywhere, and greater somewhere: newer there
- each is greater somewhere: changed on both

The alternatives each fail on a real case:

- **Content hash.** Listing would have to export every story, and an unedited story's export is not
  stable: `recordsForExport` can add a `break`, so a round trip changes the bytes.
- **`updated_at`.** It says when a row was written, not whether the other device has seen it, and
  comparing clocks across devices means trusting them.
- **A last-synced marker per pair of devices.** A counter adopted from a sender can move backwards,
  and a number used before then returns attached to different content, which reads as in sync.
- **A random token per version, with a last-seen token per pair.** No value repeats, but a token
  cannot say whether one version descends from another. If A sends an item to B and C and B edits
  it, C and B have no shared record, so C reads as changed on both when it is simply behind.
  Worse, a conflict resolved in favour of an older version reads as newer on a third device, which
  would pull a regression without asking.

A vector answers ancestry with no shared history, so status works between devices that never met.
It stays small: one row per device that ever touched the item. Counters go through JS numbers, and
at 10^7 increments a day 2^53 lasts millions of years.

Identities are lazy: an item that never synced has no rows, and a trigger's lookup finds nothing.
Duplicating an item, keeping both sides of a conflict, and file exports never pass a sync ID on, and
deleting an item deletes its sync rows. Deletions do not propagate: a deleted item reads as present
only on the other device.

`last_synced_at` sits on the same rows but stays on the device that wrote it. A counter of 0 is
legal: a device that only received an item has a row for that timestamp, and a missing device
compares as 0.

## Edits are counted by triggers

Migration 045 puts triggers on every story, vault and pack table. A write method in `database.ts`
cannot forget them, which is how `stories.updated_at` used to go wrong, and they fire whichever
connection writes.

Root tables use `AFTER UPDATE OF <columns>`, which is where "what counts as an edit" is decided.
Favourites, branch switches, retry and generation state, and a story's pack do not count: they
describe how the item is used on that device. Tables holding a story's content count on every
insert, update and delete, except `world_state_changes` (always written beside something counted),
`world_state_snapshots` (not exported), `background_images` and `kept_separate`.

The same child-table triggers set `stories.updated_at`, for every story, and `preset_packs.updated_at`.
Setting either is not an edit: neither column is in a root trigger's list.

A new table with a `story_id` or `pack_id` column must get the triggers or join the exclusion list
in `sync/device.rs`. A test reads the migrated schema and fails on anything else, because a missing
trigger shows no error: edits go uncounted and the item reads as in sync.

An edit that is reverted still reads as moved. That costs a question, never data.

## Applying an item

SQLite cannot disable a trigger, so a write made to apply an item would count as an edit. Nothing
turns the triggers off for this. A global flag outside a transaction could stay set after a crash,
leaving later edits uncounted with no sign of it, and a story import cannot be one transaction: it
is many statements plus image streaming in Rust, and the frontend cannot `BEGIN`.

- **Story:** read the old rows, import under a new ID, which has no identity so the triggers do
  nothing, and only then delete the original, so a failed import leaves it in place. One batch then
  writes the identity, the vector with its old timestamps, and the sender's `updated_at`.
- **Vault item, pack:** one `database.transaction()` batch writes the content, then the vector. The
  vector write overrides what the batch counted, which is why the device's own row is always written.
  Favourite state is left alone: it belongs to the device. A pack is updated in place because
  `stories.pack_id` is `ON DELETE RESTRICT`.

`sync_suspend` is for migrations only; see [persistence.md](persistence.md).

## Resolving a conflict

Replacing a version that holds edits the incoming one lacks gives `max(mine, theirs)` plus one on
the resolving device. The result outranks both, so a discarded version on a third device reads as
older.

A send records nothing locally, resolved or not. The receiver can refuse a push, so a resolved
vector kept at send time would outrank edits this device has never seen: the row would read as newer
here, and a plain Send would overwrite them without asking. The client remembers what it sent, in
memory for the app's lifetime so closing the sync screen does not forget it, and when a listing
shows the other device holding that vector, it adopts it and stamps the last sync. Until then the
row keeps its status. If the item was edited here since it went, the send is dropped instead:
adopting would erase that edit's count.

The push request stays open until the receiver applies the item (`applied`) or declines it
(`declined`), so the sender re-reads the section once, when there is something to see, and nothing
polls. A receiver may be across the room, so after `WEBVIEW_TIMEOUT` the server replies `waiting`
and keeps the item queued. A later answer has no one to reach; the sender's next listing shows it.
Closing the receiving sync screen declines every push still waiting, and a queue already holding
eight refuses the next.

After a pull the client sends `settleVector` with the vector it replaced and the one it ended with,
and the server adopts the new one only if its own still matches and the new one covers it. That is
the only point the server learns the item landed, so it stamps its last sync there rather than when
serving the pull. No content moves, so the server does not ask. If the item changed in the meantime,
it refuses, the client says the item may still read as out of sync, and the next listing shows the
truth.

## The server asks its webview

Rust holds no data. A `list`, `pull` or `settleVector` request is emitted as `sync://request` with a
request ID, and the handler waits on a oneshot until `sync_respond` arrives, up to
`WEBVIEW_TIMEOUT`. Client timeouts are longer, so the server's message is the one reported. Nothing
is exported up front, so a listing is always current and carries no content. Pushes go to a queue
the receiving modal polls, because the receiver may need to ask its user something. It takes the
queue whole, so a push arriving between a read and a clear cannot be lost. Each queued item carries
its request ID, and the answer comes back through `sync_respond` the same way.

Items travel in a `SyncEnvelope`: section, sync ID, vector, `updatedAt`, name, and `document`, the
item's existing export as text. On the wire the header is one JSON line and the document follows
verbatim, because nesting JSON text in JSON escapes every quote again at each level. That is exchange documents for vault items, `PackExport` for packs
(the directory format is desktop only), and the story JSON from `exportStoryToJson`. The exchange
format is unchanged; identity travels beside it.

A story's `packBinding` gains `packSyncId` on this path only, so `.avt` files carry no sync IDs.
Binding tries it first, then name and author.

The protocol is versioned by `PROTOCOL_VERSION`, carried in the QR code and in every request. A
different version refuses to sync, because keeping an older peer working would keep the preload and
title matching alive.

## Pairing

A QR code and a connection code hold the same thing: address, port, token, app version and protocol
version. The connection code is that JSON as one line of text, `av1-` plus URL-safe base64, for a
device with no camera. A camera that cannot start opens the code screen.

The token is what authorises requests, and it is a fresh UUID each time a server starts, so a code
stops working with its session. It is encoded, not encrypted: treat it as a temporary password.

The host's connected screen has **Back** alongside **Finish**. Back returns to the pairing screen
with the server still running, so the same code reconnects a device that dropped its session. Finish
stops the server.

After pasting a code, **Change address** overrides the address and port. The server takes its
address from `local_ip`, which can pick the wrong interface on a host with a VPN or several
networks. An override changes only where the client connects; the token still decides whether it is
let in.

## Device identity

The self row in `sync_device` is created by migration 045, so triggers can read it before any
frontend code runs. The name defaults to a platform label and can be changed on the QR and scan
screens. It is not in the QR code, which a rename would leave stale: the server's name comes back in
listings and the client's goes in every request.

Restoring a backup gives the device a new ID, in `restore_database`, before the swap. A backup can
land on a second device, and a rollback rewinds counters this ID has already used, so either would
let two versions share a vector. Vector rows under the old ID stay as history.
