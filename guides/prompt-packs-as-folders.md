# Prompt packs as folders: a user guide

Aventuras can write a prompt pack out as a folder of Markdown files, one per prompt, and read such
a folder back in. The folder is meant to live in a git repository. That is the whole point of it:
your own prompt edits sit on one branch, the prompts Aventuras ships sit on another, and every
release you let git merge the two instead of finding by hand what changed.

The folder export is available on desktop only. Every exported folder carries a copy of this guide
as its `README.md`, written by the same version of Aventuras that wrote the prompts beside it.

## 1. Why a folder

A custom pack is a copy. The day you make it, it holds the prompts Aventuras shipped that day, plus
whatever you change. From then on Aventuras keeps improving its own prompts and your copy never
hears about it. Comparing the two by hand, prompt by prompt, release after release, is the job this
format hands to git.

Three things make that work:

- **One prompt, one file.** git can then merge each prompt on its own and show you exactly which
  lines a release touched.
- **Nothing in the folder changes unless a prompt does.** Two exports of the same pack are
  byte-identical, so a commit only ever holds real changes.
- **The shipped prompts can be exported on their own**, from the text compiled into Aventuras, so
  no edit you made in the app can leak into what you merge from.

## 2. Setting it up, once

You need git and an empty folder.

1. Create the folder and turn it into a repository:

   ```bash
   git init
   git switch -c shipped
   ```

2. In Aventuras, open the Vault's prompt packs, open the built-in pack, and in its **Pack
   Settings** choose **Export shipped prompts to folder**. Pick the folder.
3. Commit it, naming the version you exported:

   ```bash
   git add -A
   git commit -m "Shipped prompts 1.4.0"
   ```

4. Start your own branch from it:

   ```bash
   git switch -c my-pack
   ```

5. Put your pack on that branch. Either export an existing custom pack into the same folder (the
   pack's export button, then **Folder of Markdown**), or edit the files in the folder directly and
   import them as a new pack with **Import Folder**. Commit.

From here on, `shipped` only ever receives Aventuras's own prompts, and `my-pack` holds yours.

## 3. Every release

After updating Aventuras:

1. Switch to the shipped branch **before exporting**: an export writes into whatever branch the
   folder has checked out.

   ```bash
   git switch shipped
   ```

2. Export the shipped prompts into the folder again and commit:

   ```bash
   git add -A
   git commit -m "Shipped prompts 1.5.0"
   ```

3. Merge them into your branch and resolve any conflicts (see the next section):

   ```bash
   git switch my-pack
   git merge shipped
   ```

4. In Aventuras, replace your pack from the folder: the pack's replace button, then **Folder of
   Markdown**.

Export the shipped prompts before you re-export your own pack after an update. If your branch is
exported by a newer version than the last shipped export, the two disagree about the version in
`_reference/version.md`, and the merge stops on it.

### Editing in the app and in the folder

Replacing a pack from the folder replaces it entirely. An edit you made in the app and never
exported is gone after the import. Pick one place to edit at a time: when you have edited in the
app, export the pack onto `my-pack` and commit before you merge or import anything.

## 4. When a merge conflicts

A conflict in a prompt file means a release changed the same lines you changed. Read both, keep
what you want, and remove the conflict markers. Aventuras refuses to import a file it cannot parse,
so a mangled tag will stop you at the import rather than reach a story.

Two conflicts have a fixed answer:

- **`_reference/version.md`** names the Aventuras version the reference files describe. Keep the
  shipped side, then mark it resolved. It only conflicts when your branch was exported by a
  different version than the shipped branch's previous export.

  ```bash
  git checkout --theirs _reference/version.md
  git add _reference/version.md
  ```

- **A prompt "deleted by them"** usually means a release moved that prompt to another group, and
  rewrote enough of it that git did not recognise the move. Look for the same filename in another
  folder, carry your edit over to it, then `git rm` the old file.

Once every conflict is resolved, `git commit` finishes the merge.

## 5. Coming from an older export

Folders exported by Aventuras before format 2 look different. The first export into such a folder
brings it up to date, and the confirmation lists everything it is about to change:

- every prompt moves into a numbered group folder, `Analysis/` becoming `02 Analysis/`, so the
  folders sort in the order the pack editor lists them. git records these as renames, and the old
  folders are removed once empty;
- `ABOUT.md` is deleted. This file replaces it;
- a `README.md` of your own is renamed to `README_user.md`, never overwritten;
- `_reference/` loses `template-variables.md` and `template-status.md`, and gains `version.md`.

The list of deleted files in that confirmation is long, often around eighty entries. That is
expected once: the same prompts are written back in their new folders by the same export.

## 6. What is in an exported folder

- **Group folders** (`01 Story Generation/`, `02 Analysis/`, …) hold one `.md` file per stored
  prompt. The number is the group's position in the pack editor, so the folders sort in that order.
  The folder is presentation only: it names the group Aventuras lists that prompt under, and it
  changes when Aventuras regroups a prompt or adds a group. It is **not** part of the prompt's
  identity, so moving a file between folders changes nothing. Within a folder, files sort by name.
- **A file's name is its identity.** `adventure.md` is the prompt `adventure`. A file ending
  `-user.md` is that prompt's user-message half, stored separately from its system half.
- **`08 Other/`** holds prompts whose id this version of Aventuras no longer ships. Its number is
  always the one after the last group.
- **`pack.yaml`** carries the pack's name, description, author and custom variables, and the
  version of this folder format. It holds nothing that changes from one release to the next.
- **`_reference/`** lists every variable Aventuras can fill: `system-variables.md`,
  `runtime-variables.md`, and `version.md`, the Aventuras version those lists describe. It is
  generated, never read back, and the same for every pack exported by one version.
- **`README.md`** (this guide) and **`.gitattributes`** are generated and overwritten on every
  export.

## 7. What these files actually are

**Liquid templates, not Markdown.** The `.md` extension is for your tooling's benefit — it makes
the files open, diff and search as text everywhere — but nothing renders them as Markdown.
Aventuras parses each one with Liquid and sends the result to the model. Markdown holding Liquid is
how Jekyll works too, so the pairing is ordinary; it just means the extension describes the prose,
not the syntax.

Two constructs appear:

- `{{ variableName }}` is replaced by that variable's value.
- `{% if ... %}` … `{% endif %}` (and `elsif`, `else`, `unless`, `for`, `comment`) decide whether
  a passage appears at all. Most prompts use them to drop a heading or a bullet when the story has
  nothing to put in it.

`_reference/` lists every variable Aventuras can fill and what it means. That listing is generated
from the exact version named in `_reference/version.md`, so it is the authority on what a name has
to be.

Your editor will most likely highlight these files as Markdown, which is wrong but harmless — the
Liquid tags show as plain text. Editor extensions for Liquid exist if you want real highlighting;
nothing here depends on having one.

## 8. When a prompt is broken

Two kinds of mistake, and they are treated very differently.

**Liquid that does not parse** — a tag left unclosed, an `{% endif %}` that does not match its
opening, an unclosed `{{`, or a filter Aventuras does not have. The whole import is refused before
anything is written. Every failing file is named with the line and column of the fault, and the
pack is left exactly as it was. Nothing is partially applied, so fixing the file and importing
again is always safe.

**A variable name that does not exist** — this is _not_ an error, and nothing will tell you about
it. Liquid renders an unknown name as an empty string, so `{{ protagonistNmae }}` imports cleanly,
generates cleanly, and quietly contributes nothing to the prompt forever. A misspelling costs you
the whole line it was on.

That asymmetry is worth remembering when merging: a conflict that mangles a tag stops you at the
door, while one that mangles a variable name passes silently. Check names against `_reference/`
rather than assuming a clean import means a correct prompt.

## 9. What an import reads

Only `pack.yaml` and the `.md` files inside folders. Ignored, silently:

- Markdown files at the root, such as `README.md` and `README_user.md`
- Any folder whose name starts with `_`, including `_reference/`
- Anything that is not a `.md` file

Two files anywhere in the folder with the same name are refused, since the folder they sit in does
not tell them apart. Names are compared without case, because two spellings are one file on Windows
and macOS.

**Do not keep your own notes inside a group folder, or in any folder whose name does not start with
`_`.** Any `.md` there is a prompt as far as this format is concerned: it imports as one, and if the
pack has no such prompt it is deleted on the next export. Keep your own files at the root, under any
name but `README.md`, or in a folder of your own whose name starts with `_`, such as `_notes/`. The
export never reads or deletes anything there.

## 10. An import replaces

Importing a folder over a pack replaces that pack's prompts and custom variables with what is in
the folder. A prompt the folder does not contain is removed from the pack. Deleting a file is
therefore a real deletion — which is why it should be a commit you can see.

Runtime variables are not part of this format. An import leaves a pack's runtime variable
definitions, and every value stored against them, exactly as they were.

## 11. Line endings

`.gitattributes` pins the folder to line-feed endings. Without it an editor on Windows can rewrite
every file, turning the next merge into a conflict in all of them. Keep that file.
